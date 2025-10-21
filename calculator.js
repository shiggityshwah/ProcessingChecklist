(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    const STORAGE_KEY = 'processingCalculatorState';

    // State management
    let currentMode = 'coverage';
    let state = {
        coverage: {
            rows: [],
            valueAmount: ''
        },
        hereon: {
            rows: [],
            hereonPercentage: ''
        },
        date: {
            startDate: '',
            endDate: ''
        }
    };

    // Initialize
    function init() {
        loadState().then(() => {
            setupModeListeners();
            switchToMode(currentMode);
        });
    }

    // Load state from storage
    function loadState() {
        return new Promise((resolve) => {
            ext.storage.local.get(STORAGE_KEY, (result) => {
                const savedState = result[STORAGE_KEY];
                if (savedState) {
                    // Restore saved mode
                    if (savedState.currentMode) {
                        currentMode = savedState.currentMode;
                    }

                    // Restore coverage state
                    if (savedState.coverage && savedState.coverage.rows && savedState.coverage.rows.length >= 2) {
                        state.coverage = savedState.coverage;
                    } else {
                        initCoverageState();
                    }

                    // Restore hereon state
                    if (savedState.hereon && savedState.hereon.rows && savedState.hereon.rows.length >= 2) {
                        state.hereon = savedState.hereon;
                    } else {
                        initHereonState();
                    }

                    // Restore date state
                    if (savedState.date) {
                        state.date = savedState.date;
                    }
                } else {
                    // Initialize default states
                    initCoverageState();
                    initHereonState();
                }

                resolve();
            });
        });
    }

    // Initialize coverage state
    function initCoverageState() {
        state.coverage = {
            rows: [
                { id: generateId(), value: '' },
                { id: generateId(), value: '' }
            ],
            valueAmount: ''
        };
    }

    // Initialize hereon state
    function initHereonState() {
        state.hereon = {
            rows: [
                { id: generateId(), value: '' },
                { id: generateId(), value: '' }
            ],
            hereonPercentage: ''
        };
    }

    // Save state to storage
    function saveState() {
        const saveData = {
            currentMode: currentMode,
            coverage: state.coverage,
            hereon: state.hereon,
            date: state.date
        };
        ext.storage.local.set({ [STORAGE_KEY]: saveData });
    }

    // Generate unique ID
    function generateId() {
        return Date.now() + Math.random().toString(36).substr(2, 9);
    }

    // Setup mode switching listeners
    function setupModeListeners() {
        const tabs = document.querySelectorAll('.mode-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                switchToMode(mode);
            });
        });
    }

    // Switch to a different mode
    function switchToMode(mode) {
        currentMode = mode;

        // Update tabs
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });

        // Update content visibility
        document.querySelectorAll('.mode-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${mode}-mode`).classList.add('active');

        // Update title
        const titles = {
            coverage: 'Coverage Calculator',
            hereon: 'Hereon Calculator',
            date: 'Date Calculator'
        };
        document.getElementById('main-title').textContent = titles[mode] || 'Processing Calculator';

        // Initialize the selected mode
        if (mode === 'coverage') {
            initCoverageMode();
        } else if (mode === 'hereon') {
            initHereonMode();
        } else if (mode === 'date') {
            initDateMode();
        }

        saveState();
    }

    // ============= COVERAGE MODE =============

    function initCoverageMode() {
        renderCoverageInputRows();
        renderCoverageResults();
        attachCoverageEventListeners();

        // Set the value input
        const valueInput = document.getElementById('value-input');
        if (valueInput) {
            valueInput.value = state.coverage.valueAmount;
        }
    }

    function parseDollarAmount(str) {
        if (!str) return 0;
        const cleaned = str.replace(/[^\d.-]/g, '');
        const amount = parseFloat(cleaned);
        return isNaN(amount) ? 0 : amount;
    }

    function formatDollar(amount) {
        const abs = Math.abs(amount);
        const formatted = abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return amount < 0 ? `-$${formatted}` : `$${formatted}`;
    }

    function calculateCoveragePercentages() {
        const amounts = state.coverage.rows.map(row => parseDollarAmount(row.value));
        const total = amounts.reduce((sum, amount) => sum + amount, 0);

        if (total === 0) {
            return state.coverage.rows.map(() => '0%');
        }

        return amounts.map(amount => {
            const percentage = (amount / total) * 100;
            return percentage.toFixed(1) + '%';
        });
    }

    function renderCoverageInputRows() {
        const container = document.getElementById('input-rows');
        if (!container) return;

        const percentages = calculateCoveragePercentages();

        container.innerHTML = state.coverage.rows.map((row, index) => {
            const showRemove = state.coverage.rows.length > 2;
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
            input.addEventListener('input', handleCoverageInputChange);
        });

        // Attach remove button listeners
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', handleCoverageRemoveRow);
        });
    }

    function handleCoverageInputChange(e) {
        const id = e.target.dataset.id;
        const value = e.target.value;

        const row = state.coverage.rows.find(r => r.id === id);
        if (row) {
            row.value = value;
            saveState();
            updateCoveragePercentages();
            renderCoverageResults();
        }
    }

    function updateCoveragePercentages() {
        const percentages = calculateCoveragePercentages();
        const container = document.getElementById('input-rows');
        if (!container) return;

        const percentageElements = container.querySelectorAll('.percentage');
        percentageElements.forEach((elem, index) => {
            elem.textContent = percentages[index];
        });
    }

    function handleCoverageRemoveRow(e) {
        const id = e.target.dataset.id;
        if (state.coverage.rows.length <= 2) return;

        state.coverage.rows = state.coverage.rows.filter(r => r.id !== id);
        saveState();
        renderCoverageInputRows();
        renderCoverageResults();
    }

    function handleCoverageAddRow() {
        state.coverage.rows.push({ id: generateId(), value: '' });
        saveState();
        renderCoverageInputRows();
        renderCoverageResults();
    }

    function handleCoverageValueChange(e) {
        state.coverage.valueAmount = e.target.value;
        saveState();
        renderCoverageResults();
    }

    function renderCoverageResults() {
        const container = document.getElementById('results-list');
        if (!container) return;

        const value = parseDollarAmount(state.coverage.valueAmount);

        if (value === 0) {
            container.innerHTML = '<div class="empty-results">Enter a value above to see results</div>';
            return;
        }

        const amounts = state.coverage.rows.map(row => parseDollarAmount(row.value));
        const total = amounts.reduce((sum, amount) => sum + amount, 0);

        if (total === 0) {
            container.innerHTML = '<div class="empty-results">Enter input values to calculate distribution</div>';
            return;
        }

        const results = amounts
            .map((amount, index) => {
                const percentage = amount / total;
                const result = value * percentage;
                const label = state.coverage.rows[index].value || `Row ${index + 1}`;
                return { label, result, amount };
            })
            .filter(item => item.amount > 0);

        if (results.length === 0) {
            container.innerHTML = '<div class="empty-results">Enter input values to calculate distribution</div>';
            return;
        }

        container.innerHTML = results.map(({ label, result }) => {
            const escapedLabel = window.ProcessingChecklistUtils ?
                window.ProcessingChecklistUtils.escapeHtml(label) : label;
            return `
                <div class="result-row">
                    <span class="result-label">${escapedLabel}</span>
                    <span class="result-value">${formatDollar(result)}</span>
                </div>
            `;
        }).join('');
    }

    function attachCoverageEventListeners() {
        const addBtn = document.getElementById('add-row-btn');
        if (addBtn) {
            addBtn.removeEventListener('click', handleCoverageAddRow);
            addBtn.addEventListener('click', handleCoverageAddRow);
        }

        const valueInput = document.getElementById('value-input');
        if (valueInput) {
            valueInput.removeEventListener('input', handleCoverageValueChange);
            valueInput.addEventListener('input', handleCoverageValueChange);
        }
    }

    // ============= HEREON MODE =============

    function initHereonMode() {
        renderHereonInputRows();
        renderHereonResults();
        attachHereonEventListeners();

        // Set the hereon percentage input
        const hereonPercentageInput = document.getElementById('hereon-percentage-input');
        if (hereonPercentageInput) {
            hereonPercentageInput.value = state.hereon.hereonPercentage;
        }
    }

    function parsePercentage(str) {
        if (!str) return 0;
        const cleaned = str.replace(/[^\d.-]/g, '');
        const amount = parseFloat(cleaned);
        return isNaN(amount) ? 0 : amount;
    }

    function calculateHereonPercentages() {
        const percentages = state.hereon.rows.map(row => parsePercentage(row.value));
        const total = percentages.reduce((sum, p) => sum + p, 0);

        // If no hereon percentage is set, use the total as the base
        const hereonPercentage = parsePercentage(state.hereon.hereonPercentage);
        const base = hereonPercentage > 0 ? hereonPercentage : total;

        if (base === 0) {
            return { percentages: percentages.map(() => 0), total, base, multiplier: 0 };
        }

        const multiplier = 100 / base;
        const scaledPercentages = percentages.map(p => p * multiplier);

        return { percentages: scaledPercentages, total, base, multiplier };
    }

    function renderHereonInputRows() {
        const container = document.getElementById('hereon-input-rows');
        if (!container) return;

        container.innerHTML = state.hereon.rows.map((row, index) => {
            const showRemove = state.hereon.rows.length > 2;
            return `
                <div class="input-row" data-id="${row.id}">
                    <input type="text"
                           data-id="${row.id}"
                           value="${row.value}"
                           placeholder="e.g., 33">
                    <span class="percentage">${row.value ? parsePercentage(row.value).toFixed(1) + '%' : '0%'}</span>
                    ${showRemove ? `<button class="remove-btn" data-id="${row.id}">×</button>` : ''}
                </div>
            `;
        }).join('');

        // Attach input event listeners
        container.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', handleHereonInputChange);
        });

        // Attach remove button listeners
        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', handleHereonRemoveRow);
        });
    }

    function handleHereonInputChange(e) {
        const id = e.target.dataset.id;
        const value = e.target.value;

        const row = state.hereon.rows.find(r => r.id === id);
        if (row) {
            row.value = value;
            saveState();
            updateHereonPercentages();
            renderHereonResults();
        }
    }

    function updateHereonPercentages() {
        const container = document.getElementById('hereon-input-rows');
        if (!container) return;

        const percentageElements = container.querySelectorAll('.percentage');
        percentageElements.forEach((elem, index) => {
            const row = state.hereon.rows[index];
            elem.textContent = row.value ? parsePercentage(row.value).toFixed(1) + '%' : '0%';
        });
    }

    function handleHereonRemoveRow(e) {
        const id = e.target.dataset.id;
        if (state.hereon.rows.length <= 2) return;

        state.hereon.rows = state.hereon.rows.filter(r => r.id !== id);
        saveState();
        renderHereonInputRows();
        renderHereonResults();
    }

    function handleHereonAddRow() {
        state.hereon.rows.push({ id: generateId(), value: '' });
        saveState();
        renderHereonInputRows();
        renderHereonResults();
    }

    function handleHereonPercentageChange(e) {
        state.hereon.hereonPercentage = e.target.value;
        saveState();
        renderHereonResults();
    }

    function renderHereonResults() {
        const container = document.getElementById('hereon-results-list');
        const statusContainer = document.getElementById('hereon-status');
        if (!container || !statusContainer) return;

        const { percentages, total, base, multiplier } = calculateHereonPercentages();
        const hereonPercentage = parsePercentage(state.hereon.hereonPercentage);

        // Determine if we have a valid match
        const hasHereonTarget = hereonPercentage > 0;
        const isMatch = hasHereonTarget && Math.abs(total - hereonPercentage) < 0.01;
        const difference = hasHereonTarget ? hereonPercentage - total : 0;

        // Update status display
        if (hasHereonTarget) {
            if (isMatch) {
                statusContainer.className = 'hereon-status valid';
                statusContainer.innerHTML = `
                    <span class="checkmark">✓</span> Percentages match target!
                    <span class="multiplier">Multiplier: ×${multiplier.toFixed(2)}</span>
                `;
            } else {
                statusContainer.className = 'hereon-status invalid';
                const verb = difference > 0 ? 'Missing' : 'Over by';
                statusContainer.innerHTML = `${verb} ${Math.abs(difference).toFixed(2)}% to match target`;
            }
        } else {
            if (total > 0) {
                statusContainer.className = 'hereon-status info';
                statusContainer.innerHTML = `
                    Total: ${total.toFixed(2)}% (scaled to 100%)
                    <span class="multiplier">Multiplier: ×${multiplier.toFixed(2)}</span>
                `;
            } else {
                statusContainer.className = '';
                statusContainer.innerHTML = '';
            }
        }

        // Show results if valid or if no hereon target is set
        const showResults = !hasHereonTarget || isMatch;

        // If we don't have enough data, show empty state
        if (total === 0) {
            container.innerHTML = '<div class="empty-results">Enter percentages above to see results</div>';
            container.classList.remove('grayed-out');
            return;
        }

        // Filter out rows with empty values
        const results = state.hereon.rows
            .map((row, index) => {
                const inputPercentage = parsePercentage(row.value);
                const scaledPercentage = percentages[index];
                const label = row.value || `Row ${index + 1}`;
                return { label, scaledPercentage, inputPercentage };
            })
            .filter(item => item.inputPercentage > 0);

        if (results.length === 0) {
            container.innerHTML = '<div class="empty-results">Enter percentages above to see results</div>';
            container.classList.remove('grayed-out');
            return;
        }

        // Render results
        container.innerHTML = results.map(({ label, scaledPercentage }) => {
            const escapedLabel = window.ProcessingChecklistUtils ?
                window.ProcessingChecklistUtils.escapeHtml(label) : label;
            return `
                <div class="result-row">
                    <span class="result-label">${escapedLabel}</span>
                    <span class="result-value">${scaledPercentage.toFixed(1)}%</span>
                </div>
            `;
        }).join('');

        // Apply grayed-out style if not showing final results
        if (!showResults) {
            container.classList.add('grayed-out');
        } else {
            container.classList.remove('grayed-out');
        }
    }

    function attachHereonEventListeners() {
        const addBtn = document.getElementById('hereon-add-row-btn');
        if (addBtn) {
            addBtn.removeEventListener('click', handleHereonAddRow);
            addBtn.addEventListener('click', handleHereonAddRow);
        }

        const hereonPercentageInput = document.getElementById('hereon-percentage-input');
        if (hereonPercentageInput) {
            hereonPercentageInput.removeEventListener('input', handleHereonPercentageChange);
            hereonPercentageInput.addEventListener('input', handleHereonPercentageChange);
        }
    }

    // ============= DATE MODE =============

    function initDateMode() {
        attachDateEventListeners();

        // Set the date inputs
        const startDateInput = document.getElementById('date-start-input');
        if (startDateInput) {
            startDateInput.value = state.date.startDate;
        }

        const endDateInput = document.getElementById('date-end-input');
        if (endDateInput) {
            endDateInput.value = state.date.endDate;
        }

        renderDateResults();
    }

    function handleDateStartChange(e) {
        state.date.startDate = e.target.value;
        saveState();
        renderDateResults();
    }

    function handleDateEndChange(e) {
        state.date.endDate = e.target.value;
        saveState();
        renderDateResults();
    }

    function calculateExactMonths(startDate, endDate) {
        let years = endDate.getFullYear() - startDate.getFullYear();
        let months = endDate.getMonth() - startDate.getMonth();
        let days = endDate.getDate() - startDate.getDate();

        // Adjust for negative days
        if (days < 0) {
            months--;
            const prevMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 0);
            days += prevMonth.getDate();
        }

        // Adjust for negative months
        if (months < 0) {
            years--;
            months += 12;
        }

        const totalMonths = years * 12 + months;
        return { years, months, days, totalMonths };
    }

    function renderDateResults() {
        const container = document.getElementById('date-results-list');
        if (!container) return;

        const startDateStr = state.date.startDate;
        const endDateStr = state.date.endDate;

        if (!startDateStr || !endDateStr) {
            container.innerHTML = '<div class="empty-results">Select two dates to see results</div>';
            return;
        }

        const startDate = new Date(startDateStr + 'T00:00:00');
        const endDate = new Date(endDateStr + 'T00:00:00');

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            container.innerHTML = '<div class="empty-results">Invalid date format</div>';
            return;
        }

        if (endDate < startDate) {
            container.innerHTML = '<div class="empty-results">End date must be after start date</div>';
            return;
        }

        // Calculate total days
        const timeDiff = endDate.getTime() - startDate.getTime();
        const totalDays = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

        // Calculate exact months
        const { years, months, days, totalMonths } = calculateExactMonths(startDate, endDate);

        // Build display string for months breakdown
        let monthsDisplay = '';
        if (years > 0) {
            monthsDisplay += `${years} year${years > 1 ? 's' : ''}`;
        }
        if (months > 0) {
            if (monthsDisplay) monthsDisplay += ', ';
            monthsDisplay += `${months} month${months > 1 ? 's' : ''}`;
        }
        if (days > 0) {
            if (monthsDisplay) monthsDisplay += ', ';
            monthsDisplay += `${days} day${days > 1 ? 's' : ''}`;
        }
        if (!monthsDisplay) {
            monthsDisplay = '0 days';
        }

        container.innerHTML = `
            <div class="result-row">
                <span class="result-label">Total Days</span>
                <span class="result-value">${totalDays} day${totalDays !== 1 ? 's' : ''}</span>
            </div>
            <div class="result-row">
                <span class="result-label">Total Months</span>
                <span class="result-value">${totalMonths} month${totalMonths !== 1 ? 's' : ''}</span>
            </div>
            <div class="result-row">
                <span class="result-label">Exact Duration</span>
                <span class="result-value">${monthsDisplay}</span>
            </div>
        `;
    }

    function attachDateEventListeners() {
        const startDateInput = document.getElementById('date-start-input');
        if (startDateInput) {
            startDateInput.removeEventListener('change', handleDateStartChange);
            startDateInput.addEventListener('change', handleDateStartChange);
        }

        const endDateInput = document.getElementById('date-end-input');
        if (endDateInput) {
            endDateInput.removeEventListener('change', handleDateEndChange);
            endDateInput.addEventListener('change', handleDateEndChange);
        }
    }

    // Start the app
    init();
})();
