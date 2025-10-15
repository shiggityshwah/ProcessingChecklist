(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    const STORAGE_KEY = 'processingCalculatorState';

    let rows = [];
    let valueAmount = '';

    // Initialize
    function init() {
        loadState().then(() => {
            renderInputRows();
            renderResults();
            attachEventListeners();
        });
    }

    // Load state from storage
    function loadState() {
        return new Promise((resolve) => {
            ext.storage.local.get(STORAGE_KEY, (result) => {
                const state = result[STORAGE_KEY];
                if (state && state.rows && state.rows.length >= 2) {
                    rows = state.rows;
                    valueAmount = state.valueAmount || '';
                } else {
                    // Initialize with 2 default rows
                    rows = [
                        { id: generateId(), value: '' },
                        { id: generateId(), value: '' }
                    ];
                    valueAmount = '';
                }

                // Set the value input
                const valueInput = document.getElementById('value-input');
                if (valueInput) {
                    valueInput.value = valueAmount;
                }

                resolve();
            });
        });
    }

    // Save state to storage
    function saveState() {
        const state = {
            rows: rows,
            valueAmount: valueAmount
        };
        ext.storage.local.set({ [STORAGE_KEY]: state });
    }

    // Generate unique ID
    function generateId() {
        return Date.now() + Math.random().toString(36).substr(2, 9);
    }

    // Parse dollar amount from string
    function parseDollarAmount(str) {
        if (!str) return 0;
        // Remove everything except digits, dots, and minus sign
        const cleaned = str.replace(/[^\d.-]/g, '');
        const amount = parseFloat(cleaned);
        return isNaN(amount) ? 0 : amount;
    }

    // Format as dollar amount
    function formatDollar(amount) {
        const abs = Math.abs(amount);
        const formatted = abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return amount < 0 ? `-$${formatted}` : `$${formatted}`;
    }

    // Calculate percentages
    function calculatePercentages() {
        const amounts = rows.map(row => parseDollarAmount(row.value));
        const total = amounts.reduce((sum, amount) => sum + amount, 0);

        if (total === 0) {
            return rows.map(() => '0%');
        }

        return amounts.map(amount => {
            const percentage = (amount / total) * 100;
            return percentage.toFixed(1) + '%';
        });
    }

    // Render input rows
    function renderInputRows() {
        const container = document.getElementById('input-rows');
        if (!container) return;

        const percentages = calculatePercentages();

        container.innerHTML = rows.map((row, index) => {
            const showRemove = rows.length > 2;
            return `
                <div class="input-row" data-id="${row.id}">
                    <input type="text"
                           data-id="${row.id}"
                           value="${row.value}"
                           placeholder="$0.00">
                    <span class="percentage">${percentages[index]}</span>
                    ${showRemove ? `<button class="remove-btn" data-id="${row.id}">×</button>` : ''}
                </div>
            `;
        }).join('');

        // Attach input event listeners
        container.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', handleInputChange);
        });

        // Attach remove button listeners
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', handleRemoveRow);
        });
    }

    // Handle input change
    function handleInputChange(e) {
        const id = e.target.dataset.id;
        const value = e.target.value;

        const row = rows.find(r => r.id === id);
        if (row) {
            row.value = value;
            saveState();
            updatePercentages();
            renderResults();
        }
    }

    // Update only percentages (more efficient than full re-render)
    function updatePercentages() {
        const percentages = calculatePercentages();
        const container = document.getElementById('input-rows');
        if (!container) return;

        const percentageElements = container.querySelectorAll('.percentage');
        percentageElements.forEach((elem, index) => {
            elem.textContent = percentages[index];
        });
    }

    // Handle remove row
    function handleRemoveRow(e) {
        const id = e.target.dataset.id;
        if (rows.length <= 2) return; // Always keep at least 2 rows

        rows = rows.filter(r => r.id !== id);
        saveState();
        renderInputRows();
        renderResults();
    }

    // Handle add row
    function handleAddRow() {
        rows.push({ id: generateId(), value: '' });
        saveState();
        renderInputRows();
        renderResults();
    }

    // Handle value input change
    function handleValueChange(e) {
        valueAmount = e.target.value;
        saveState();
        renderResults();
    }

    // Render results
    function renderResults() {
        const container = document.getElementById('results-list');
        if (!container) return;

        const value = parseDollarAmount(valueAmount);

        if (value === 0) {
            container.innerHTML = '<div class="empty-results">Enter a value above to see results</div>';
            return;
        }

        const amounts = rows.map(row => parseDollarAmount(row.value));
        const total = amounts.reduce((sum, amount) => sum + amount, 0);

        if (total === 0) {
            container.innerHTML = '<div class="empty-results">Enter input values to calculate distribution</div>';
            return;
        }

        // Filter out rows with empty values (amount === 0)
        const results = amounts
            .map((amount, index) => {
                const percentage = amount / total;
                const result = value * percentage;
                const label = rows[index].value || `Row ${index + 1}`;
                return { label, result, amount };
            })
            .filter(item => item.amount > 0); // Only include rows with non-zero amounts

        if (results.length === 0) {
            container.innerHTML = '<div class="empty-results">Enter input values to calculate distribution</div>';
            return;
        }

        container.innerHTML = results.map(({ label, result }) => `
            <div class="result-row">
                <span class="result-label">${label}</span>
                <span class="result-value">${formatDollar(result)}</span>
            </div>
        `).join('');
    }

    // Attach event listeners
    function attachEventListeners() {
        const addBtn = document.getElementById('add-row-btn');
        if (addBtn) {
            addBtn.addEventListener('click', handleAddRow);
        }

        const valueInput = document.getElementById('value-input');
        if (valueInput) {
            valueInput.addEventListener('input', handleValueChange);
        }
    }

    // Start the app
    init();
})();
