let currentSheetId = localStorage.getItem('sheetId') || null;
let expensesData = [];
let expenseChart = null;

function updateCurrentSheetLabel() {
    const label = document.getElementById('current-sheet-label');
    if (!label) return;
    if (currentSheetId) {
        label.textContent = 'Current sheet';
        label.title = currentSheetId;
        label.classList.remove('hidden');
    } else {
        label.classList.add('hidden');
    }
}

function openTrackerInterface(sheetId, { isNew = false } = {}) {
    currentSheetId = sheetId;
    localStorage.setItem('sheetId', sheetId);
    updateCurrentSheetLabel();
    document.getElementById('tracker-content').classList.remove('hidden');

    if (isNew) {
        expensesData = [];
        renderTable();
        renderSummaries();
    }

    loadExpenses();
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const authRes = await fetch('/auth/status');
        const authData = await authRes.json();

        if (authData.loggedIn) {
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('app-view').classList.remove('hidden');
            updateCurrentSheetLabel();

            if (currentSheetId) {
                openTrackerInterface(currentSheetId);
            } else {
                document.getElementById('tracker-content').classList.remove('hidden');
                expensesData = [];
                renderTable();
                renderSummaries();
            }
        }
    } catch (err) {
        console.error('Auth check failed:', err);
    }
});

// --- AUTHENTICATION ---
document.getElementById('login-btn').addEventListener('click', async () => {
    const btn = document.getElementById('login-btn');
    btn.classList.add('is-loading');
    try {
        const res = await fetch('/auth/url');
        const data = await res.json();
        window.location.href = data.url;
    } catch (err) {
        console.error(err);
        btn.classList.remove('is-loading');
    }
});

/* Light interactive tilt on login card */
(function initLoginCardMotion() {
    const card = document.getElementById('login-card');
    const screen = document.getElementById('login-view');
    if (!card || !screen) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    screen.addEventListener('pointermove', (e) => {
        if (screen.classList.contains('hidden')) return;
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(0)`;
    });

    screen.addEventListener('pointerleave', () => {
        card.style.transform = '';
    });
})();

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
});

// --- FEATURES SLIDER (left panel — contracts main layout) ---
const featuresPanel = document.getElementById('features-panel');
const featuresBtn = document.getElementById('features-btn');

function openFeaturesPanel() {
    featuresPanel.classList.add('is-open');
    featuresPanel.setAttribute('aria-hidden', 'false');
    featuresBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('features-open');
    window.dispatchEvent(new Event('resize'));
}

function closeFeaturesPanel() {
    featuresPanel.classList.remove('is-open');
    featuresPanel.setAttribute('aria-hidden', 'true');
    featuresBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('features-open');
    window.dispatchEvent(new Event('resize'));
}

function toggleFeaturesPanel() {
    if (featuresPanel.classList.contains('is-open')) closeFeaturesPanel();
    else openFeaturesPanel();
}

featuresBtn.addEventListener('click', toggleFeaturesPanel);
document.getElementById('features-close-btn').addEventListener('click', closeFeaturesPanel);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && featuresPanel.classList.contains('is-open')) {
        closeFeaturesPanel();
    }
});

// --- SINGLE SHEET: Import to Google Sheet ---
document.getElementById('import-sheet-btn').addEventListener('click', async () => {
    const btn = document.getElementById('import-sheet-btn');

    if (currentSheetId) {
        window.open(`https://docs.google.com/spreadsheets/d/${currentSheetId}`, '_blank', 'noopener,noreferrer');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Importing…';

    try {
        const res = await fetch('/api/sheet/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: `MudraSync ${new Date().toLocaleDateString('en-IN')}` })
        });
        const data = await res.json();

        if (!res.ok) {
            if (data.needsLogin || res.status === 401) {
                alert('Session expired. Please log in again.');
                window.location.reload();
                return;
            }
            throw new Error(data.error || 'Could not import to Google Sheet');
        }

        if (!data.spreadsheetId) throw new Error('No spreadsheet ID returned');

        openTrackerInterface(data.spreadsheetId, { isNew: true });
        window.open(`https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
        console.error('Import sheet failed:', err);
        alert(err.message || 'Failed to import to Google Sheet.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Import to Google Sheet';
    }
});

// --- DATA FETCHING & RENDERING ---
async function loadExpenses() {
    if (!currentSheetId) return;
    try {
        const res = await fetch(`/api/expenses/${currentSheetId}`);
        if (!res.ok) throw new Error('Server returned an error');
        const data = await res.json();

        expensesData = (data && data.expenses) ? data.expenses : [];
        renderTable();
        renderSummaries();
    } catch (error) {
        console.error('Failed to load expenses:', error);
        expensesData = [];
        renderTable();
        renderSummaries();
    }
}

function renderTable() {
    const tbody = document.getElementById('expense-table-body');
    tbody.innerHTML = '';

    if (expensesData.length === 0) {
        tbody.innerHTML = '<div class="empty-state">No transactions yet. Add one above.</div>';
        return;
    }

    [...expensesData].reverse().forEach((row, reversedIndex) => {
        const originalIndex = expensesData.length - 1 - reversedIndex;
        const dateObj = new Date(row[0]);
        const dateStr = dateObj.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });

        const item = document.createElement('div');
        item.className = 'transaction-row';
        item.innerHTML = `
            <div class="tx-info">
                <div class="tx-desc">${row[2] || 'Expense'}</div>
                <div class="tx-meta">
                    <span class="tx-badge">${row[1]}</span>
                    <span>${dateStr}</span>
                </div>
            </div>
            <div class="tx-amount-group">
                <div class="tx-amount">₹${parseFloat(row[3]).toFixed(2)}</div>
                <div class="tx-actions">
                    <button type="button" class="action-link" onclick="editExpense(${originalIndex})">Edit</button>
                    <button type="button" class="action-link delete" onclick="deleteExpense(${originalIndex})">Delete</button>
                </div>
            </div>
        `;
        tbody.appendChild(item);
    });
}

function renderSummaries() {
    const currentMonth = new Date().getMonth();
    let monthlyTotal = 0;
    const categoryTotals = {};

    expensesData.forEach(row => {
        if (!row[0] || !row[3]) return;
        const amt = parseFloat(row[3]);
        const cat = row[1] || 'Other';
        const date = new Date(row[0]);

        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
        if (date.getMonth() === currentMonth) monthlyTotal += amt;
    });

    document.getElementById('monthly-total').innerText =
        `₹${monthlyTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    const catUl = document.getElementById('category-totals');
    catUl.innerHTML = '';
    for (const [cat, total] of Object.entries(categoryTotals)) {
        catUl.innerHTML += `<li><span class="cat-name">${cat}</span><span class="cat-total">₹${total.toLocaleString('en-IN')}</span></li>`;
    }

    const canvas = document.getElementById('expenseChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (expenseChart) expenseChart.destroy();

    const labels = Object.keys(categoryTotals);
    const values = Object.values(categoryTotals);

    expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['No data'],
            datasets: [{
                data: values.length ? values : [1],
                backgroundColor: labels.length
                    ? ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b']
                    : ['#e5e7eb'],
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    display: labels.length > 0,
                    position: 'right',
                    labels: { usePointStyle: true, boxWidth: 6, font: { family: 'Inter', size: 11 } }
                }
            }
        }
    });
}

// --- OPTIMISTIC FORM HANDLING ---
document.getElementById('expense-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentSheetId) {
        alert('Click “Import to Google Sheet” first.');
        return;
    }

    const date = document.getElementById('exp-date').value;
    const category = document.getElementById('exp-category').value;
    const desc = document.getElementById('exp-desc').value;
    const amount = document.getElementById('exp-amount').value;
    const editIndex = document.getElementById('edit-index').value;

    const payload = { date, category, description: desc, amount };
    const newRow = [date, category, desc, amount];

    if (editIndex !== '') {
        expensesData[editIndex] = newRow;
        renderTable();
        renderSummaries();
        fetch(`/api/expenses/${currentSheetId}/${editIndex}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => console.error(err));

        document.getElementById('edit-index').value = '';
        document.getElementById('cancel-edit').classList.add('hidden');
    } else {
        expensesData.push(newRow);
        renderTable();
        renderSummaries();
        fetch(`/api/expenses/${currentSheetId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => console.error(err));
    }
    e.target.reset();
});

window.editExpense = (index) => {
    const row = expensesData[index];
    document.getElementById('exp-date').value = row[0];
    document.getElementById('exp-category').value = row[1];
    document.getElementById('exp-desc').value = row[2];
    document.getElementById('exp-amount').value = row[3];
    document.getElementById('edit-index').value = index;
    document.getElementById('cancel-edit').classList.remove('hidden');
};

document.getElementById('cancel-edit').addEventListener('click', () => {
    document.getElementById('expense-form').reset();
    document.getElementById('edit-index').value = '';
    document.getElementById('cancel-edit').classList.add('hidden');
});

window.deleteExpense = (index) => {
    if (!confirm('Delete this transaction?')) return;
    expensesData.splice(index, 1);
    renderTable();
    renderSummaries();
    fetch(`/api/expenses/${currentSheetId}/${index}`, { method: 'DELETE' }).catch(err => console.error(err));
};
