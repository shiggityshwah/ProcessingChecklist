(function() {
    "use strict";

    const DEBUG = false;
    function dbg(...args) { if (DEBUG && console && console.debug) console.debug("[ProcessingChecklist-Tracking]", ...args); }
    const LOG_PREFIX = "[ProcessingChecklist-Tracking]";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    let port = null;

    // Current view state
    let currentView = 'queue'; // 'queue' or 'history'
    let currentFilter = 'all'; // 'all', 'completed', 'reviewed', 'in-progress'

    // Initialize
    function init() {
        console.info(LOG_PREFIX, "Tracking window initialized");

        // Connect to background
        try {
            port = ext.runtime.connect({ name: "tracking" });
            console.info(LOG_PREFIX, "Connected to background script");

            port.onMessage.addListener(handleMessage);
            port.onDisconnect.addListener(() => {
                console.warn(LOG_PREFIX, "Disconnected from background");
                port = null;
            });
        } catch (error) {
            console.error(LOG_PREFIX, "Failed to connect to background:", error);
        }

        // Setup UI event listeners
        setupEventListeners();

        // Load and render data
        loadAndRender();

        // Listen for storage changes
        ext.storage.onChanged.addListener(handleStorageChange);
    }

    function setupEventListeners() {
        // View toggle
        document.getElementById('view-toggle-btn').addEventListener('click', toggleView);

        // Queue view buttons
        document.getElementById('add-forms-btn').addEventListener('click', handleAddForms);
        document.getElementById('clear-paste-btn').addEventListener('click', handleClearPaste);
        document.getElementById('clear-queue-btn').addEventListener('click', handleClearQueue);
        document.getElementById('next-form-btn').addEventListener('click', handleNextForm);

        // History view buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => handleFilterChange(e.target.dataset.filter));
        });
        document.getElementById('extended-history-btn').addEventListener('click', handleExtendedHistory);
    }

    function handleMessage(message) {
        dbg("Received message:", message);

        // Handle different message types
        if (message.action === 'progress-update' || message.action === 'form-detected') {
            loadAndRender();
        }
    }

    function handleStorageChange(changes, namespace) {
        if (namespace !== 'local') return;

        // Check if tracking data changed
        if (changes.tracking_availableForms || changes.tracking_history) {
            dbg("Tracking data changed, refreshing");
            loadAndRender();
        }
    }

    // View management
    function toggleView() {
        if (currentView === 'queue') {
            currentView = 'history';
            document.getElementById('queue-view').classList.remove('active');
            document.getElementById('history-view').classList.add('active');
            document.getElementById('view-toggle-btn').textContent = 'Back to Queue';
        } else {
            currentView = 'queue';
            document.getElementById('history-view').classList.remove('active');
            document.getElementById('queue-view').classList.add('active');
            document.getElementById('view-toggle-btn').textContent = 'View History';
        }
        loadAndRender();
    }

    function handleFilterChange(filter) {
        currentFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderHistory();
    }

    // Load and render all data
    function loadAndRender() {
        if (currentView === 'queue') {
            renderQueue();
        } else {
            renderHistory();
        }
    }

    // Queue view rendering
    function renderQueue() {
        ext.storage.local.get('tracking_availableForms', (result) => {
            const forms = result.tracking_availableForms || [];
            const tbody = document.querySelector('#available-forms-table tbody');
            tbody.innerHTML = '';

            if (forms.length === 0) {
                tbody.innerHTML = '<tr class="empty-state"><td colspan="5">No forms in queue. Paste forms above to get started.</td></tr>';
                document.getElementById('next-form-btn').disabled = true;
                return;
            }

            forms.forEach((form, index) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="max-width: 150px;"><a href="#" class="clickable-link" data-index="${index}">${escapeHtml(form.policyNumber || 'N/A')}</a></td>
                    <td style="max-width: 125px;">${escapeHtml(form.submissionNumber || 'N/A')}</td>
                    <td style="max-width: 100px;">${escapeHtml(form.premium || '')}</td>
                    <td>${escapeHtml(form.policyType || '')}</td>
                    <td style="max-width: 125px;">${escapeHtml(form.broker || '')}</td>
                    <td style="white-space: nowrap;">
                        <button class="action-btn action-btn-delete" data-action="delete" data-index="${index}" title="Delete">✕</button>
                        <button class="action-btn action-btn-move" data-action="move-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="Move Up">↑</button>
                        <button class="action-btn action-btn-move" data-action="move-top" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="Move to Top">⇈</button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            // Add click handlers
            tbody.querySelectorAll('.clickable-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const index = parseInt(e.target.dataset.index);
                    openForm(forms[index]);
                });
            });

            tbody.querySelectorAll('.action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.target.dataset.action;
                    const index = parseInt(e.target.dataset.index);
                    handleQueueAction(action, index);
                });
            });

            // Enable next form button
            document.getElementById('next-form-btn').disabled = false;
        });
    }

    // History view rendering
    function renderHistory() {
        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            const tbody = document.querySelector('#history-table tbody');
            tbody.innerHTML = '';

            // Apply filter
            const filteredHistory = history.filter(item => {
                if (currentFilter === 'all') return true;
                if (currentFilter === 'completed') {
                    return item.manuallyMarkedComplete || (item.checkedProgress && item.checkedProgress.percentage === 100);
                }
                if (currentFilter === 'reviewed') {
                    return item.reviewedProgress && item.reviewedProgress.current > 0;
                }
                if (currentFilter === 'in-progress') {
                    return !item.manuallyMarkedComplete && (!item.checkedProgress || item.checkedProgress.percentage < 100);
                }
                return true;
            });

            if (filteredHistory.length === 0) {
                tbody.innerHTML = '<tr class="empty-state"><td colspan="4">No forms match this filter.</td></tr>';
                return;
            }

            // Sort by most recent first (newest added first)
            filteredHistory.sort((a, b) => {
                const dateA = new Date(a.addedDate || 0);
                const dateB = new Date(b.addedDate || 0);
                return dateB - dateA;
            });

            filteredHistory.forEach((item) => {
                const row = document.createElement('tr');

                // Calculate progress display
                const checkedProgress = item.checkedProgress || { current: 0, total: 0, percentage: 0 };

                let checkedDisplay = `${checkedProgress.current}/${checkedProgress.total} (${checkedProgress.percentage}%)`;
                let checkedClass = 'progress-incomplete';

                if (item.manuallyMarkedComplete) {
                    checkedDisplay = `${checkedProgress.total}/${checkedProgress.total} (100%)`;
                    checkedClass = 'progress-complete';
                } else if (checkedProgress.percentage === 100) {
                    checkedClass = 'progress-complete';
                } else if (checkedProgress.percentage === 0) {
                    checkedClass = 'progress-empty';
                }

                row.innerHTML = `
                    <td><a href="#" class="clickable-link" data-url-id="${escapeHtml(item.urlId)}">${escapeHtml(item.policyNumber || 'N/A')}</a></td>
                    <td>${escapeHtml(item.policyType || '')}</td>
                    <td>
                        <span class="progress-badge ${checkedClass}">${checkedDisplay}</span>
                        ${item.manuallyMarkedComplete ? '<span class="manual-complete-badge" title="Manually marked complete">✓</span>' : ''}
                    </td>
                    <td>
                        <button class="action-btn action-btn-delete" data-action="delete-history" data-url-id="${escapeHtml(item.urlId)}">Delete</button>
                        <button class="action-btn action-btn-complete" data-action="toggle-complete" data-url-id="${escapeHtml(item.urlId)}">${item.manuallyMarkedComplete ? 'Undo' : 'Mark Complete'}</button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            // Add click handlers
            tbody.querySelectorAll('.clickable-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const urlId = e.target.dataset.urlId;
                    const item = history.find(h => h.urlId === urlId);
                    if (item) {
                        reopenForm(item);
                    }
                });
            });

            tbody.querySelectorAll('.action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.target.dataset.action;
                    const urlId = e.target.dataset.urlId;
                    handleHistoryAction(action, urlId);
                });
            });
        });
    }

    // Queue actions
    function handleQueueAction(action, index) {
        ext.storage.local.get('tracking_availableForms', (result) => {
            let forms = result.tracking_availableForms || [];

            if (action === 'delete') {
                forms.splice(index, 1);
            } else if (action === 'move-up' && index > 0) {
                [forms[index - 1], forms[index]] = [forms[index], forms[index - 1]];
            } else if (action === 'move-top' && index > 0) {
                const item = forms.splice(index, 1)[0];
                forms.unshift(item);
            }

            ext.storage.local.set({ tracking_availableForms: forms }, () => {
                renderQueue();
            });
        });
    }

    // History actions
    function handleHistoryAction(action, urlId) {
        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];

            if (action === 'delete-history') {
                if (confirm('Are you sure you want to delete this form from history?')) {
                    history = history.filter(h => h.urlId !== urlId);
                    ext.storage.local.set({ tracking_history: history }, () => {
                        renderHistory();
                    });
                }
            } else if (action === 'toggle-complete') {
                const item = history.find(h => h.urlId === urlId);
                if (item) {
                    item.manuallyMarkedComplete = !item.manuallyMarkedComplete;
                    ext.storage.local.set({ tracking_history: history }, () => {
                        renderHistory();
                    });
                }
            }
        });
    }

    // Add forms from paste area
    function handleAddForms() {
        const pasteAreaHtml = document.getElementById('paste-area-html');
        const html = pasteAreaHtml.innerHTML;
        const text = pasteAreaHtml.innerText.trim();
        const errorMsg = document.getElementById('queue-error');

        if (!text) {
            showError('Please paste form data first');
            return;
        }

        // Parse HTML to extract hyperlinks
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Get all table rows (Excel pastes as table)
        let rows = Array.from(tempDiv.querySelectorAll('tr'));

        // If no table rows, try parsing as plain text lines
        if (rows.length === 0) {
            const lines = text.split('\n').filter(line => line.trim());
            rows = lines.map(line => {
                const div = document.createElement('div');
                div.textContent = line;
                return div;
            });
        }

        const newForms = [];
        const errors = [];

        rows.forEach((row, rowIndex) => {
            // Get all cells in the row
            let cells = Array.from(row.querySelectorAll('td'));

            // If no td cells, try th cells (header row)
            if (cells.length === 0) {
                cells = Array.from(row.querySelectorAll('th'));
            }

            // If still no cells, try parsing as tab-separated text
            if (cells.length === 0) {
                const rowText = row.textContent || row.innerText || '';
                const parts = rowText.split('\t');
                if (parts.length >= 5) {
                    cells = parts.map(part => {
                        const div = document.createElement('div');
                        div.textContent = part;
                        return div;
                    });
                }
            }

            // Skip if not enough columns (need at least 5 for all required data)
            if (cells.length < 5) {
                if (rowIndex > 0 || cells.length > 0) { // Skip completely empty rows
                    errors.push(`Row ${rowIndex + 1}: Expected at least 5 columns, found ${cells.length}`);
                }
                return;
            }

            // Column mapping (flexible: supports both 7-column and 9-column formats)
            // 7 columns: [0]=Submission#(URL), [1]=Policy#(URL), [2]=Premium, [3]=Broker(URL), [4]=Type
            // 9 columns: [0]=Submission#(URL), [1]=irrelevant, [2]=Policy#(URL), [3]=Premium, [4]=irrelevant, [5]=Broker(URL), [6]=Type, [7]=irrelevant, [8]=irrelevant
            let submissionCell, policyCell, premiumCell, brokerCell, typeCell;

            if (cells.length >= 7) {
                // 9-column format (or at least 7)
                submissionCell = cells[0];
                policyCell = cells[2];
                premiumCell = cells[3];
                brokerCell = cells[5];
                typeCell = cells[6];
            } else {
                // 5 or 7-column format (irrelevant columns removed)
                submissionCell = cells[0];
                policyCell = cells[1];
                premiumCell = cells[2];
                brokerCell = cells[3];
                typeCell = cells[4];
            }

            // Look for hyperlink in policy number cell (column 3 / index 2)
            const link = policyCell.querySelector('a');
            let url = null;
            let policyNumber = policyCell.textContent.trim();

            if (link && link.href) {
                url = link.href;
                policyNumber = link.textContent.trim();
            } else {
                // Try to extract URL from text content
                const urlMatch = policyNumber.match(/https?:\/\/[^\s]+/);
                if (urlMatch) {
                    url = urlMatch[0];
                    policyNumber = policyNumber.replace(urlMatch[0], '').trim();
                }
            }

            // If no URL found, show error
            if (!url) {
                errors.push(`Row ${rowIndex + 1}: Could not find URL hyperlink in policy number cell (column 3). Make sure to copy with hyperlinks from Excel.`);
                return;
            }

            // Extract URL ID from URL
            const urlId = extractUrlId(url);
            if (!urlId) {
                errors.push(`Row ${rowIndex + 1}: Could not extract tracking ID from URL: ${url}`);
                return;
            }

            const submissionNumber = submissionCell.textContent.trim();
            const premium = premiumCell.textContent.trim();
            const broker = brokerCell.textContent.trim();
            const policyType = typeCell.textContent.trim();

            newForms.push({
                urlId,
                url: url,
                policyNumber: policyNumber || 'N/A',
                submissionNumber: submissionNumber || '',
                premium: premium || '',
                broker: broker || '',
                policyType: policyType || '',
                addedDate: new Date().toISOString()
            });
        });

        if (errors.length > 0) {
            showError(errors.join('<br>'));
            return;
        }

        // Check for duplicates and add forms
        ext.storage.local.get('tracking_availableForms', (result) => {
            let forms = result.tracking_availableForms || [];
            const duplicates = [];

            newForms.forEach(newForm => {
                const exists = forms.some(f => f.urlId.toLowerCase() === newForm.urlId.toLowerCase());
                if (exists) {
                    duplicates.push(newForm.urlId);
                } else {
                    forms.push(newForm);
                }
            });

            if (duplicates.length > 0) {
                showError(`Duplicate forms detected (already in queue): ${duplicates.join(', ')}`);
                return;
            }

            ext.storage.local.set({ tracking_availableForms: forms }, () => {
                pasteAreaHtml.innerHTML = '';
                hideError();
                renderQueue();
            });
        });
    }

    function handleClearPaste() {
        const pasteAreaHtml = document.getElementById('paste-area-html');
        pasteAreaHtml.innerHTML = '';
        hideError();
    }

    function handleClearQueue() {
        if (confirm('Are you sure you want to clear all forms from the queue?')) {
            ext.storage.local.set({ tracking_availableForms: [] }, () => {
                renderQueue();
            });
        }
    }

    function handleNextForm() {
        ext.storage.local.get('tracking_availableForms', (result) => {
            const forms = result.tracking_availableForms || [];
            if (forms.length > 0) {
                openForm(forms[0]);
            }
        });
    }

    function handleExtendedHistory() {
        const url = ext.runtime.getURL('extended-history.html');
        ext.tabs.create({ url });
    }

    // Form opening
    function openForm(form) {
        dbg("Opening form:", form);
        ext.tabs.create({ url: form.url }, (tab) => {
            // The form will be detected by content script when page loads
        });
    }

    function reopenForm(item) {
        dbg("Reopening form:", item);

        // Check if complete - if so, open in review mode
        const isComplete = item.manuallyMarkedComplete || (item.checkedProgress && item.checkedProgress.percentage === 100);

        if (isComplete) {
            // Send message to start review mode
            if (port) {
                port.postMessage({
                    action: 'start-review',
                    urlId: item.urlId,
                    url: item.url
                });
            }
        }

        // Open the tab
        ext.tabs.create({ url: item.url });
    }

    // Utility functions
    function extractUrlId(url) {
        // Pattern 1: /Policy/TransactionDetails/Edit/019579767?doc=open
        const editMatch = url.match(/\/Edit\/(\d+)/);
        if (editMatch) {
            return editMatch[1];
        }

        // Pattern 2: /Operations/WorkItem/BeginProcessing/09435836 (temporary ID)
        const beginMatch = url.match(/\/BeginProcessing\/(\d+)/);
        if (beginMatch) {
            return `temp_${beginMatch[1]}`;
        }

        return null;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showError(message) {
        const errorMsg = document.getElementById('queue-error');
        errorMsg.innerHTML = message;
        errorMsg.classList.add('show');
    }

    function hideError() {
        const errorMsg = document.getElementById('queue-error');
        errorMsg.classList.remove('show');
    }

    // Start the app
    init();
})();
