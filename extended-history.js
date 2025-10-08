(function() {
    "use strict";

    const DEBUG = false;
    function dbg(...args) { if (DEBUG && console && console.debug) console.debug("[ProcessingChecklist-ExtendedHistory]", ...args); }
    const LOG_PREFIX = "[ProcessingChecklist-ExtendedHistory]";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;

    function init() {
        console.info(LOG_PREFIX, "Extended history page initialized");
        loadAndRender();

        // Listen for storage changes
        ext.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.tracking_history) {
                loadAndRender();
            }
        });
    }

    function loadAndRender() {
        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            renderHistory(history);
        });
    }

    function renderHistory(history) {
        const container = document.getElementById('history-container');

        if (history.length === 0) {
            container.innerHTML = '<div class="empty-state">No history yet. Process some forms to see them here.</div>';
            return;
        }

        // Group by day
        const groupedByDay = groupByDay(history);

        // Sort days (newest first)
        const sortedDays = Object.keys(groupedByDay).sort((a, b) => {
            return new Date(b) - new Date(a);
        });

        container.innerHTML = '';

        sortedDays.forEach(day => {
            const items = groupedByDay[day];
            const daySection = createDaySection(day, items);
            container.appendChild(daySection);
        });
    }

    function groupByDay(history) {
        const grouped = {};

        history.forEach(item => {
            const date = new Date(item.addedDate || Date.now());
            const dayKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            if (!grouped[dayKey]) {
                grouped[dayKey] = [];
            }
            grouped[dayKey].push(item);
        });

        return grouped;
    }

    function createDaySection(day, items) {
        const section = document.createElement('div');
        section.className = 'day-section';

        // Count completed items
        const completedItems = items.filter(item => {
            return item.manuallyMarkedComplete || (item.checkedProgress && item.checkedProgress.percentage === 100);
        });

        const header = document.createElement('div');
        header.className = 'day-header';
        header.innerHTML = `
            <div class="day-title">${day} (${items.length} form${items.length !== 1 ? 's' : ''})</div>
            <button class="daily-review-btn" ${completedItems.length === 0 ? 'disabled' : ''} data-day="${day}">
                Random Review (${completedItems.length} completed)
            </button>
        `;
        section.appendChild(header);

        // Add click handler for daily review button
        const reviewBtn = header.querySelector('.daily-review-btn');
        if (completedItems.length > 0) {
            reviewBtn.addEventListener('click', () => handleDailyReview(completedItems));
        }

        // Create table
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';

        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Policy Number</th>
                    <th>Submission Number</th>
                    <th>Broker</th>
                    <th>Type</th>
                    <th>Checked Progress</th>
                    <th>Reviewed Progress</th>
                    <th>Primary Named Insured</th>
                    <th>Total Taxable Premium</th>
                    <th>Added</th>
                    <th>Started</th>
                    <th>Completed</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');

        // Sort items by added time (newest first within the day)
        items.sort((a, b) => {
            return new Date(b.addedDate) - new Date(a.addedDate);
        });

        items.forEach(item => {
            const row = createRow(item);
            tbody.appendChild(row);
        });

        tableContainer.appendChild(table);
        section.appendChild(tableContainer);

        return section;
    }

    function createRow(item) {
        const row = document.createElement('tr');

        // Calculate progress display
        const checkedProgress = item.checkedProgress || { current: 0, total: 0, percentage: 0 };
        const reviewedProgress = item.reviewedProgress || null;

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

        let reviewedDisplay = '—';
        if (reviewedProgress && reviewedProgress.current > 0) {
            reviewedDisplay = `${reviewedProgress.current}/${reviewedProgress.total} (${reviewedProgress.percentage}%)`;
        }

        const addedTime = item.addedDate ? new Date(item.addedDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
        const movedToHistoryTime = item.movedToHistoryDate ? new Date(item.movedToHistoryDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
        const completedTime = item.completedDate ? new Date(item.completedDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';

        // Check if premium changed from imported value
        const premiumChanged = item.premium && item.totalTaxablePremium &&
            item.premium !== item.totalTaxablePremium;
        const premiumDisplay = item.totalTaxablePremium || '—';
        const premiumFlag = premiumChanged ? ' <span style="color: #dc3545; font-weight: bold;" title="Premium changed from imported value">⚠</span>' : '';

        row.innerHTML = `
            <td><a href="#" class="clickable-link" data-url-id="${escapeHtml(item.urlId)}">${escapeHtml(item.policyNumber || 'N/A')}</a></td>
            <td>${escapeHtml(item.submissionNumber || 'N/A')}</td>
            <td>${escapeHtml(item.broker || '')}</td>
            <td>${escapeHtml(item.policyType || '')}</td>
            <td>
                <span class="progress-badge ${checkedClass}">${checkedDisplay}</span>
                ${item.manuallyMarkedComplete ? '<span class="manual-complete-badge" title="Manually marked complete">✓</span>' : ''}
            </td>
            <td>${reviewedDisplay}</td>
            <td>${escapeHtml(item.primaryNamedInsured || '—')}</td>
            <td>${escapeHtml(premiumDisplay)}${premiumFlag}</td>
            <td>${addedTime}</td>
            <td>${movedToHistoryTime}</td>
            <td>${completedTime}</td>
        `;

        // Add click handler for policy link
        const link = row.querySelector('.clickable-link');
        link.addEventListener('click', (e) => {
            e.preventDefault();
            reopenForm(item);
        });

        return row;
    }

    function handleDailyReview(completedItems) {
        if (completedItems.length === 0) return;

        // Pick a random completed item
        const randomIndex = Math.floor(Math.random() * completedItems.length);
        const randomItem = completedItems[randomIndex];

        dbg("Starting daily review for:", randomItem);

        // Use reopenForm to handle two-tab opening and review mode
        reopenForm(randomItem);
    }

    function reopenForm(item) {
        dbg("Reopening form:", item);

        // Check if complete - if so, open in review mode
        const isComplete = item.manuallyMarkedComplete || (item.checkedProgress && item.checkedProgress.percentage === 100);

        // Remove doc=open flag from URL for main tab
        const cleanUrl = item.url.replace(/[?&]doc=open/gi, '');

        console.log(LOG_PREFIX, "Reopening form - original URL:", item.url);
        console.log(LOG_PREFIX, "Reopening form - clean URL:", cleanUrl);
        console.log(LOG_PREFIX, "URLs are different:", item.url !== cleanUrl);

        // Open the tab without doc=open
        ext.tabs.create({ url: cleanUrl, active: true }, (mainTab) => {
            console.log(LOG_PREFIX, "Main tab opened with ID:", mainTab.id);

            if (isComplete) {
                // Send message to start review mode after a delay
                setTimeout(() => {
                    ext.tabs.sendMessage(mainTab.id, {
                        action: 'start-review',
                        urlId: item.urlId
                    });
                }, 1000);
            }

            // If original URL had doc=open, handle download in background (even in review mode)
            if (item.url !== cleanUrl) {
                console.log(LOG_PREFIX, "Opening background tab for document download:", item.url);

                // Open background tab with doc=open for download
                ext.tabs.create({ url: item.url, active: false }, (downloadTab) => {
                    console.log(LOG_PREFIX, "Background download tab opened with ID:", downloadTab.id);

                    let tabClosed = false;

                    const closeTab = () => {
                        if (tabClosed) return;
                        tabClosed = true;
                        ext.tabs.remove(downloadTab.id).then(() => {
                            console.log(LOG_PREFIX, "Background download tab closed successfully");
                        }).catch((err) => {
                            console.warn(LOG_PREFIX, "Tab already closed or error:", err);
                        });
                    };

                    // Monitor tab for download completion before closing
                    const downloadListener = (downloadItem) => {
                        console.log(LOG_PREFIX, "Download detected:", downloadItem.url);
                        if (downloadItem.url === item.url || downloadItem.url.startsWith(item.url.split('?')[0])) {
                            console.log(LOG_PREFIX, "Download matches form URL, closing tab in 2 seconds");
                            setTimeout(closeTab, 2000);
                            ext.downloads.onCreated.removeListener(downloadListener);
                        }
                    };

                    ext.downloads.onCreated.addListener(downloadListener);

                    // Fallback: close tab after 10 seconds regardless
                    setTimeout(() => {
                        console.log(LOG_PREFIX, "Timeout reached, closing background tab");
                        closeTab();
                        ext.downloads.onCreated.removeListener(downloadListener);
                    }, 10000);
                });
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    init();
})();
