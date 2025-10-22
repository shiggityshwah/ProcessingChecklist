(function() {
    "use strict";

    const DEBUG = false;
    function dbg(...args) { if (DEBUG && console && console.debug) console.debug("[ProcessingChecklist-ExtendedHistory]", ...args); }
    const LOG_PREFIX = "[ProcessingChecklist-ExtendedHistory]";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;

    // Delete mode state
    let deleteMode = false;
    let selectedItems = new Set(); // urlIds

    // Production rate data
    let productionRateData = { timeEntries: {} };

    /**
     * Map transaction type letter code to full description
     */
    function mapTypeCodeToDescription(code) {
        if (!code) return '';

        const upperCode = code.toUpperCase();
        const typeMap = {
            'N': 'New Business',
            'R': 'Renewal',
            'X': 'Extension',
            'E': 'Endorsement',
            'A': 'Audit',
            'C': 'Cancellation',
            'BN': 'Backout',
            'BR': 'Backout',
            'BX': 'Backout',
            'BE': 'Backout',
            'BA': 'Backout',
            'BC': 'Backout'
        };

        return typeMap[upperCode] || code;
    }

    function init() {
        console.info(LOG_PREFIX, "Extended history page initialized");

        // Load production rate data
        loadProductionRateData().then(() => {
            loadAndRender();
        });

        // Attach delete mode button listeners
        attachDeleteModeListeners();

        // Listen for storage changes
        ext.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                if (changes.tracking_history) {
                    loadAndRender();
                }
                if (changes.tracking_productionRate) {
                    productionRateData = changes.tracking_productionRate.newValue || { timeEntries: {} };
                    loadAndRender(); // Re-render to update rates
                }
            }
        });
    }

    /**
     * Load production rate data from storage
     */
    function loadProductionRateData() {
        return new Promise((resolve) => {
            ext.storage.local.get('tracking_productionRate', (result) => {
                if (result.tracking_productionRate) {
                    productionRateData = result.tracking_productionRate;
                }
                dbg("Production rate data loaded:", productionRateData);
                resolve();
            });
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
            // Use movedToHistoryDate (when started) instead of addedDate
            const date = new Date(item.movedToHistoryDate || item.addedDate || Date.now());
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

        // Calculate daily stats
        const stats = calculateDayStats(day, items);
        const isTodayFlag = isTodayDay(day);

        const header = document.createElement('div');
        header.className = 'day-header';
        header.innerHTML = `
            <div class="day-title">${day} (${items.length} form${items.length !== 1 ? 's' : ''})</div>
            <div class="day-delete-controls" style="display: none;">
                <button class="select-all-btn day-select-all" data-day="${escapeHtml(day)}">Select All (This Day)</button>
                <button class="deselect-all-btn day-deselect-all" data-day="${escapeHtml(day)}">Deselect All (This Day)</button>
                <button class="delete-selected-btn day-delete-selected" data-day="${escapeHtml(day)}" disabled>Delete 0 from This Day</button>
            </div>
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

        // Add click handlers for day delete controls
        const daySelectAll = header.querySelector('.day-select-all');
        const dayDeselectAll = header.querySelector('.day-deselect-all');
        const dayDeleteSelected = header.querySelector('.day-delete-selected');

        daySelectAll.addEventListener('click', () => selectAllInDay(items));
        dayDeselectAll.addEventListener('click', () => deselectAllInDay(items));
        dayDeleteSelected.addEventListener('click', () => deleteSelectedItems());

        // Add stats box
        const statsBox = createStatsBox(stats, isTodayFlag);
        section.appendChild(statsBox);

        // Create table
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';

        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th class="checkbox-column" style="display: none;"></th>
                    <th>Policy Number</th>
                    <th>Submission Number</th>
                    <th>Broker</th>
                    <th>Type</th>
                    <th>Checked Progress</th>
                    <th>Reviewed Progress</th>
                    <th>Primary Named Insured</th>
                    <th>Total Taxable Premium</th>
                    <th>Started</th>
                    <th>Completed</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');

        // Sort items by started time (newest first within the day)
        items.sort((a, b) => {
            const dateA = new Date(a.movedToHistoryDate || a.addedDate || 0);
            const dateB = new Date(b.movedToHistoryDate || b.addedDate || 0);
            return dateB - dateA;
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

        // Calculate reviewed progress display with styling
        let reviewedDisplay = '—';
        let reviewedClass = 'progress-empty';
        let reviewedCheckmark = '';

        if (reviewedProgress && reviewedProgress.current > 0) {
            reviewedDisplay = `${reviewedProgress.current}/${reviewedProgress.total} (${reviewedProgress.percentage}%)`;

            if (reviewedProgress.percentage === 100) {
                reviewedClass = 'progress-review-complete';
                reviewedCheckmark = '<span class="review-complete-badge" title="Review completed">✓</span>';
            } else {
                reviewedClass = 'progress-incomplete';
            }
        }

        const reviewedDisplayHtml = reviewedProgress && reviewedProgress.current > 0
            ? `<span class="progress-badge ${reviewedClass}">${reviewedDisplay}</span>${reviewedCheckmark}`
            : reviewedDisplay;

        const movedToHistoryTime = item.movedToHistoryDate ? new Date(item.movedToHistoryDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';

        // Show completed time - use manualCompletionDate if manually marked, otherwise use completedDate
        let completedTime = '—';
        if (item.manualCompletionDate) {
            completedTime = new Date(item.manualCompletionDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else if (item.completedDate) {
            completedTime = new Date(item.completedDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        }

        // Check if premium changed from imported value
        const premiumChanged = item.premium && item.totalTaxablePremium &&
            item.premium !== item.totalTaxablePremium;
        const premiumDisplay = item.totalTaxablePremium || '—';
        const premiumStyle = premiumChanged ? ' style="color: #28a745; font-weight: 600;"' : '';
        const premiumTitle = premiumChanged ? ` title="Initial value: ${escapeHtml(item.premium)}"` : '';

        // Get full type description and check for changes
        const fullTypeDescription = mapTypeCodeToDescription(item.policyType || '');
        const typeChanged = item.originalPolicyType && item.originalPolicyType !== item.policyType;
        const typeStyle = typeChanged ? ' style="color: #28a745; font-weight: 600;"' : '';
        const typeTitle = typeChanged ? ` title="Initial value: ${mapTypeCodeToDescription(item.originalPolicyType)}"` : '';

        const isChecked = selectedItems.has(item.urlId);
        row.innerHTML = `
            <td class="checkbox-column" style="display: none;"><input type="checkbox" class="delete-checkbox" data-url-id="${escapeHtml(item.urlId)}" ${isChecked ? 'checked' : ''}></td>
            <td><a href="#" class="clickable-link" data-url-id="${escapeHtml(item.urlId)}" title="${escapeHtml(item.url || '')}">${escapeHtml(item.policyNumber || 'N/A')}</a></td>
            <td>${escapeHtml(item.submissionNumber || 'N/A')}</td>
            <td>${escapeHtml(item.broker || '')}</td>
            <td><span${typeStyle}${typeTitle}>${escapeHtml(fullTypeDescription)}</span></td>
            <td>
                <span class="progress-badge ${checkedClass}">${checkedDisplay}</span>
                ${item.manuallyMarkedComplete ? '<span class="manual-complete-badge" title="Manually marked complete">✓</span>' : ''}
            </td>
            <td>${reviewedDisplayHtml}</td>
            <td>${escapeHtml(item.primaryNamedInsured || '—')}</td>
            <td><span${premiumStyle}${premiumTitle}>${escapeHtml(premiumDisplay)}</span></td>
            <td>${movedToHistoryTime}</td>
            <td>${completedTime}</td>
        `;

        // Add click handler for policy link
        const link = row.querySelector('.clickable-link');
        link.addEventListener('click', (e) => {
            e.preventDefault();
            reopenForm(item);
        });

        // Add click handler for checkbox
        const checkbox = row.querySelector('.delete-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                handleCheckboxChange(item.urlId, e.target.checked);
            });
        }

        return row;
    }

    function handleDailyReview(completedItems) {
        if (completedItems.length === 0) return;

        // Filter out items that are already reviewed (100% reviewed progress)
        const unreviewed = completedItems.filter(item => {
            if (!item.reviewedProgress) return true; // Not reviewed at all
            return item.reviewedProgress.percentage < 100; // Not fully reviewed
        });

        // If all items are fully reviewed, inform the user
        if (unreviewed.length === 0) {
            alert('All completed forms have been fully reviewed!');
            return;
        }

        // Pick a random unreviewed completed item
        const randomIndex = Math.floor(Math.random() * unreviewed.length);
        const randomItem = unreviewed[randomIndex];

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

    /**
     * Calculate daily statistics
     */
    function calculateDayStats(day, items) {
        const dateKey = convertDayToDateKey(day);
        const timeEntry = productionRateData.timeEntries[dateKey];
        const completed = items.filter(item =>
            item.manuallyMarkedComplete || (item.checkedProgress && item.checkedProgress.percentage === 100)
        );

        const completedCount = completed.length;
        const prodHours = timeEntry?.prodHours || 0;
        const rate = prodHours > 0 ? completedCount / prodHours : 0;
        const avgMinutes = completedCount > 0 && prodHours > 0 ? (prodHours * 60) / completedCount : 0;

        return {
            completedCount,
            prodHours,
            rate,
            avgMinutes,
            hasTimeData: !!timeEntry
        };
    }

    /**
     * Convert day string to date key (YYYY-MM-DD)
     */
    function convertDayToDateKey(day) {
        // day format: "January 21, 2025"
        const date = new Date(day);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const dayNum = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${dayNum}`;
    }

    /**
     * Check if a day string represents today
     */
    function isTodayDay(day) {
        const today = new Date();
        const todayStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        return day === todayStr;
    }

    /**
     * Calculate current rate for today
     */
    function calculateCurrentRate(items) {
        const completed = items.filter(item =>
            item.manuallyMarkedComplete || (item.checkedProgress && item.checkedProgress.percentage === 100)
        );

        if (completed.length === 0) return 0;

        // Get first form timestamp
        const timestamps = completed
            .map(f => new Date(f.movedToHistoryDate || f.addedDate))
            .sort((a, b) => a - b);
        const firstFormTime = timestamps[0];

        if (!firstFormTime) return 0;

        // Calculate elapsed hours
        const now = new Date();
        const elapsedHours = (now - firstFormTime) / (1000 * 60 * 60);

        return elapsedHours > 0 ? completed.length / elapsedHours : 0;
    }

    /**
     * Create stats box element
     */
    function createStatsBox(stats, isToday) {
        const statsBox = document.createElement('div');
        statsBox.className = stats.hasTimeData ? 'day-stats' : 'day-stats no-data';

        if (!stats.hasTimeData) {
            statsBox.innerHTML = `
                <div class="stat-item" style="grid-column: 1 / -1;">
                    <div class="stat-value no-data">⏱️ No production time data</div>
                    <div class="stat-message">Set production time in the Tracking window to see rate statistics</div>
                </div>
            `;
            return statsBox;
        }

        let statsHtml = `
            <div class="stat-item">
                <div class="stat-label">Completed Today</div>
                <div class="stat-value">${stats.completedCount} forms</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Production Time</div>
                <div class="stat-value">${stats.prodHours.toFixed(2)} hours</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Rate</div>
                <div class="stat-value">${stats.rate.toFixed(2)} forms/hr</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Avg Time per Form</div>
                <div class="stat-value">${stats.avgMinutes.toFixed(1)} min/form</div>
            </div>
        `;

        // Add current rate for today
        if (isToday && stats.completedCount > 0) {
            const currentRateItems = Array.from(document.querySelectorAll('.day-section'))
                .find(section => section.querySelector('.day-title').textContent.includes(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })));

            // Get all items from this day for current rate calculation
            ext.storage.local.get('tracking_history', (result) => {
                const history = result.tracking_history || [];
                const today = new Date().toISOString().split('T')[0];

                const todayItems = history.filter(item => {
                    if (!item.movedToHistoryDate && !item.addedDate) return false;
                    const itemDate = new Date(item.movedToHistoryDate || item.addedDate).toISOString().split('T')[0];
                    return itemDate === today;
                });

                const currentRate = calculateCurrentRate(todayItems);

                // Update the stats box with current rate
                const currentRateEl = statsBox.querySelector('.current-rate-value');
                if (currentRateEl) {
                    currentRateEl.textContent = `${currentRate.toFixed(2)} forms/hr`;
                }
            });

            statsHtml += `
                <div class="stat-item">
                    <div class="stat-label">Current Rate (Live)</div>
                    <div class="stat-value current-rate current-rate-value">Calculating...</div>
                </div>
            `;
        }

        statsBox.innerHTML = statsHtml;
        return statsBox;
    }

    /**
     * Delete mode functions
     */
    function attachDeleteModeListeners() {
        const enterBtn = document.getElementById('enter-delete-mode-btn');
        const cancelBtn = document.getElementById('cancel-delete-mode-btn');
        const selectAllBtn = document.getElementById('select-all-btn');
        const deselectAllBtn = document.getElementById('deselect-all-btn');
        const deleteSelectedBtn = document.getElementById('delete-selected-btn');

        enterBtn.addEventListener('click', enterDeleteMode);
        cancelBtn.addEventListener('click', exitDeleteMode);
        selectAllBtn.addEventListener('click', selectAll);
        deselectAllBtn.addEventListener('click', deselectAll);
        deleteSelectedBtn.addEventListener('click', deleteSelectedItems);
    }

    function enterDeleteMode() {
        deleteMode = true;
        document.body.classList.add('delete-mode');

        // Show/hide buttons
        document.getElementById('enter-delete-mode-btn').style.display = 'none';
        document.getElementById('cancel-delete-mode-btn').style.display = 'block';
        document.getElementById('select-all-btn').style.display = 'block';
        document.getElementById('deselect-all-btn').style.display = 'block';
        document.getElementById('delete-selected-btn').style.display = 'block';

        // Show checkboxes
        document.querySelectorAll('.checkbox-column').forEach(el => {
            el.style.display = 'table-cell';
        });

        // Show day delete controls
        document.querySelectorAll('.day-delete-controls').forEach(el => {
            el.style.display = 'flex';
        });
    }

    function exitDeleteMode() {
        deleteMode = false;
        document.body.classList.remove('delete-mode');
        selectedItems.clear();

        // Show/hide buttons
        document.getElementById('enter-delete-mode-btn').style.display = 'block';
        document.getElementById('cancel-delete-mode-btn').style.display = 'none';
        document.getElementById('select-all-btn').style.display = 'none';
        document.getElementById('deselect-all-btn').style.display = 'none';
        document.getElementById('delete-selected-btn').style.display = 'none';

        // Hide checkboxes
        document.querySelectorAll('.checkbox-column').forEach(el => {
            el.style.display = 'none';
        });

        // Hide day delete controls
        document.querySelectorAll('.day-delete-controls').forEach(el => {
            el.style.display = 'none';
        });

        updateDeleteButtonStates();
    }

    function handleCheckboxChange(urlId, checked) {
        if (checked) {
            selectedItems.add(urlId);
        } else {
            selectedItems.delete(urlId);
        }
        updateDeleteButtonStates();
    }

    function selectAll() {
        document.querySelectorAll('.delete-checkbox').forEach(checkbox => {
            checkbox.checked = true;
            selectedItems.add(checkbox.dataset.urlId);
        });
        updateDeleteButtonStates();
    }

    function deselectAll() {
        document.querySelectorAll('.delete-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });
        selectedItems.clear();
        updateDeleteButtonStates();
    }

    function selectAllInDay(items) {
        items.forEach(item => {
            const checkbox = document.querySelector(`.delete-checkbox[data-url-id="${escapeAttribute(item.urlId)}"]`);
            if (checkbox) {
                checkbox.checked = true;
                selectedItems.add(item.urlId);
            }
        });
        updateDeleteButtonStates();
    }

    function deselectAllInDay(items) {
        items.forEach(item => {
            const checkbox = document.querySelector(`.delete-checkbox[data-url-id="${escapeAttribute(item.urlId)}"]`);
            if (checkbox) {
                checkbox.checked = false;
                selectedItems.delete(item.urlId);
            }
        });
        updateDeleteButtonStates();
    }

    function updateDeleteButtonStates() {
        const count = selectedItems.size;
        const globalDeleteBtn = document.getElementById('delete-selected-btn');

        if (globalDeleteBtn) {
            globalDeleteBtn.disabled = count === 0;
            globalDeleteBtn.textContent = `Delete ${count} Selected Item${count !== 1 ? 's' : ''}`;
        }

        // Update per-day delete buttons
        document.querySelectorAll('.day-delete-selected').forEach(btn => {
            const day = btn.dataset.day;
            const daySections = document.querySelectorAll('.day-section');

            daySections.forEach(section => {
                const dayTitle = section.querySelector('.day-title');
                if (dayTitle && dayTitle.textContent.includes(day)) {
                    const checkboxes = section.querySelectorAll('.delete-checkbox:checked');
                    const dayCount = checkboxes.length;
                    const dayBtn = section.querySelector('.day-delete-selected');

                    if (dayBtn) {
                        dayBtn.disabled = dayCount === 0;
                        dayBtn.textContent = `Delete ${dayCount} from This Day`;
                    }
                }
            });
        });
    }

    function deleteSelectedItems() {
        if (selectedItems.size === 0) return;

        const confirmed = confirm(`Delete ${selectedItems.size} item${selectedItems.size !== 1 ? 's' : ''}? This cannot be undone.`);
        if (!confirmed) return;

        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            const filtered = history.filter(item => !selectedItems.has(item.urlId));

            ext.storage.local.set({ tracking_history: filtered }, () => {
                console.log(LOG_PREFIX, `Deleted ${selectedItems.size} items`);
                selectedItems.clear();
                exitDeleteMode();
                // Re-render will be triggered by storage listener
            });
        });
    }

    function escapeAttribute(text) {
        return text.replace(/"/g, '&quot;');
    }

    init();
})();
