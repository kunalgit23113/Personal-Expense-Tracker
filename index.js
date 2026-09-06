require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(cookieParser());
app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// Helper function to get Sheets API client (sync — prefer getAuthedClient for write routes)
const getSheetsClient = (req) => {
    const token = req.cookies.access_token;
    const refresh = req.cookies.refresh_token;
    if (!token && !refresh) throw new Error('Not authenticated');
    oauth2Client.setCredentials({ access_token: token, refresh_token: refresh });
    return google.sheets({ version: 'v4', auth: oauth2Client });
};

// --- AUTHENTICATION ROUTES ---
app.get('/auth/url', (req, res) => {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes
    });
    res.json({ url });
});

app.get('/auth/callback', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        const cookieOpts = { httpOnly: true, sameSite: 'lax' };
        res.cookie('access_token', tokens.access_token, cookieOpts);
        if (tokens.refresh_token) {
            res.cookie('refresh_token', tokens.refresh_token, cookieOpts);
        }
        res.redirect('/');
    } catch (error) {
        res.status(500).send('Authentication failed');
    }
});

app.get('/auth/status', (req, res) => {
    res.json({ loggedIn: !!(req.cookies.access_token || req.cookies.refresh_token) });
});

app.post('/auth/logout', (req, res) => {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.json({ success: true });
});

// Helper: attach tokens and refresh access token when needed
const getAuthedClient = async (req, res) => {
    const accessToken = req.cookies.access_token;
    const refreshToken = req.cookies.refresh_token;
    if (!accessToken && !refreshToken) {
        throw new Error('Not authenticated');
    }

    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
    });

    try {
        const tokenResponse = await oauth2Client.getAccessToken();
        const freshToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
        if (freshToken && freshToken !== accessToken) {
            res.cookie('access_token', freshToken, { httpOnly: true, sameSite: 'lax' });
        }
    } catch (err) {
        if (!accessToken) throw new Error('Not authenticated');
    }

    return google.sheets({ version: 'v4', auth: oauth2Client });
};

// --- SHEETS API ROUTES ---

// Create a new sheet and add headers
app.post('/api/sheet/create', async (req, res) => {
    try {
        const sheets = await getAuthedClient(req, res);
        const title = (req.body && req.body.title)
            ? String(req.body.title).trim().slice(0, 80)
            : `MudraSync ${new Date().toLocaleDateString('en-IN')}`;

        const sheet = await sheets.spreadsheets.create({
            resource: {
                properties: { title: title || `MudraSync ${new Date().toLocaleDateString('en-IN')}` },
                sheets: [{ properties: { title: 'Sheet1' } }]
            }
        });
        const spreadsheetId = sheet.data.spreadsheetId;
        const spreadsheetUrl = sheet.data.spreadsheetUrl
            || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Sheet1!A1:D1',
            valueInputOption: 'RAW',
            resource: { values: [['Date', 'Category', 'Description', 'Amount']] }
        });

        res.json({ spreadsheetId, title, spreadsheetUrl });
    } catch (error) {
        const status = /Not authenticated|invalid_grant|Invalid Credentials/i.test(error.message) ? 401 : 500;
        res.status(status).json({
            error: error.message || 'Failed to create sheet',
            needsLogin: status === 401
        });
    }
});

// Get all expenses
app.get('/api/expenses/:spreadsheetId', async (req, res) => {
    try {
        const sheets = getSheetsClient(req);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: req.params.spreadsheetId,
            range: 'Sheet1!A2:D',
        });
        res.json({ expenses: response.data.values || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add a new expense
app.post('/api/expenses/:spreadsheetId', async (req, res) => {
    try {
        const sheets = getSheetsClient(req);
        const { date, category, description, amount } = req.body;
        await sheets.spreadsheets.values.append({
            spreadsheetId: req.params.spreadsheetId,
            range: 'Sheet1!A:D',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[date, category, description, amount]] }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Edit an expense (rowIndex is 0-based from the frontend, but sheet rows start at 1. Header is row 1, data starts at row 2)
app.put('/api/expenses/:spreadsheetId/:rowIndex', async (req, res) => {
    try {
        const sheets = getSheetsClient(req);
        const { date, category, description, amount } = req.body;
        const actualRow = parseInt(req.params.rowIndex) + 2; 
        await sheets.spreadsheets.values.update({
            spreadsheetId: req.params.spreadsheetId,
            range: `Sheet1!A${actualRow}:D${actualRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[date, category, description, amount]] }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete an expense (True deletion of row)
app.delete('/api/expenses/:spreadsheetId/:rowIndex', async (req, res) => {
    try {
        const sheets = getSheetsClient(req);
        const actualRow = parseInt(req.params.rowIndex) + 2; // +2 for header and 0-index offset
        
        // First get the sheetId (usually 0 for Sheet1)
        const meta = await sheets.spreadsheets.get({ spreadsheetId: req.params.spreadsheetId });
        const sheetId = meta.data.sheets[0].properties.sheetId;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: req.params.spreadsheetId,
            resource: {
                requests: [{
                    deleteDimension: {
                        range: { sheetId: sheetId, dimension: 'ROWS', startIndex: actualRow - 1, endIndex: actualRow }
                    }
                }]
            }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));