(function() {
    "use strict";

    const LOG_PREFIX = "[ProcessingChecklist-ChangesReport]";
    const ext = (typeof browser !== 'undefined') ? browser : chrome;

    // Current filters
    let userFilters = {
        startDate: null,
        endDate: null
    };

    let brokerFilters = {
        broker: 'all',
        startDate: null,
        endDate: null
    };

    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        console.log(LOG_PREFIX, "Changes report initialized");
        initializeTabs();
        initializeFilters();
        loadUserReport();
        loadBrokerAnalysis();
    });

    /**
     * Initialize tab switching
     */
    function initializeTabs() {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;

                // Update tab active state
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update content active state
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                document.getElementById(tabId).classList.add('active');

                // Load data for the selected tab
                if (tabId === 'user-report') {
                    loadUserReport();
                } else if (tabId === 'broker-analysis') {
                    loadBrokerAnalysis();
                } else if (tabId === 'review-mistakes') {
                    loadReviewMistakes();
                }
            });
        });
    }

    /**
     * Initialize date filters and event listeners
     */
    function initializeFilters() {
        // Set default dates to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('user-start-date').value = today;
        document.getElementById('user-end-date').value = today;
        document.getElementById('broker-start-date').value = today;
        document.getElementById('broker-end-date').value = today;
        document.getElementById('review-start-date').value = today;
        document.getElementById('review-end-date').value = today;

        // User report filter button
        document.getElementById('user-apply-btn').addEventListener('click', () => {
            userFilters.startDate = document.getElementById('user-start-date').value;
            userFilters.endDate = document.getElementById('user-end-date').value;
            loadUserReport();
        });

        // Broker analysis filter button
        document.getElementById('broker-apply-btn').addEventListener('click', () => {
            brokerFilters.broker = document.getElementById('broker-select').value;
            brokerFilters.startDate = document.getElementById('broker-start-date').value;
            brokerFilters.endDate = document.getElementById('broker-end-date').value;
            loadBrokerAnalysis();
        });

        // Review mistakes filter button
        document.getElementById('review-apply-btn').addEventListener('click', () => {
            loadReviewMistakes();
        });

        // Export buttons
        document.getElementById('user-export-btn').addEventListener('click', () => exportBreakdownToCSV('user'));
        document.getElementById('broker-export-btn').addEventListener('click', () => exportBreakdownToCSV('broker'));
    }

    /**
     * Load and render user report
     */
    function loadUserReport() {
        const container = document.getElementById('user-forms-container');
        const summaryContainer = document.getElementById('user-summary');

        container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading changes data...</div></div>';
        summaryContainer.innerHTML = '';

        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            const startDate = userFilters.startDate || document.getElementById('user-start-date').value;
            const endDate = userFilters.endDate || document.getElementById('user-end-date').value;

            // Filter forms by date range
            const filteredForms = history.filter(form => {
                const formDate = new Date(form.movedToHistoryDate || form.addedDate);
                const dateStr = formDate.toISOString().split('T')[0];
                return dateStr >= startDate && dateStr <= endDate;
            });

            // Calculate summary statistics
            const summary = calculateUserSummary(filteredForms);
            renderUserSummary(summary);

            // Render detailed breakdown
            renderDetailedBreakdown(filteredForms, 'user');

            // Render forms
            if (filteredForms.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📊</div>
                        <div class="empty-state-text">No forms found in this date range</div>
                        <div class="empty-state-subtext">Try selecting a different date range</div>
                    </div>
                `;
                return;
            }

            // Group forms by date
            const formsByDate = groupFormsByDate(filteredForms);
            renderUserForms(formsByDate);
        });
    }

    /**
     * Calculate summary statistics for user report
     */
    function calculateUserSummary(forms) {
        let totalForms = forms.length;
        let formsWithChanges = 0;
        let totalFieldsChanged = 0;
        let totalReviewChanges = 0;
        let mostChangedSteps = {};

        forms.forEach(form => {
            const changes = form.fieldChanges || {};
            const reviewChanges = form.reviewModeChanges || {};

            if (changes.totalFieldsChanged > 0) {
                formsWithChanges++;
                totalFieldsChanged += changes.totalFieldsChanged;
            }

            if (reviewChanges.totalFieldsChanged > 0) {
                totalReviewChanges += reviewChanges.totalFieldsChanged;
            }

            // Track most changed steps
            if (changes.stepsWithChanges) {
                changes.stepsWithChanges.forEach(step => {
                    mostChangedSteps[step.stepName] = (mostChangedSteps[step.stepName] || 0) + 1;
                });
            }
        });

        // Find top 3 most changed steps
        const topSteps = Object.entries(mostChangedSteps)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));

        return {
            totalForms,
            formsWithChanges,
            formsWithChangesPercent: totalForms > 0 ? Math.round((formsWithChanges / totalForms) * 100) : 0,
            totalFieldsChanged,
            totalReviewChanges,
            topSteps
        };
    }

    /**
     * Render user summary cards
     */
    function renderUserSummary(summary) {
        const container = document.getElementById('user-summary');
        container.innerHTML = `
            <div class="summary-card">
                <div class="summary-card-label">Total Forms</div>
                <div class="summary-card-value">${summary.totalForms}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">Forms with Changes</div>
                <div class="summary-card-value">${summary.formsWithChanges}</div>
                <div class="summary-card-subtext">${summary.formsWithChangesPercent}% of total</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">Total Fields Changed</div>
                <div class="summary-card-value">${summary.totalFieldsChanged}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">Review Mode Changes</div>
                <div class="summary-card-value">${summary.totalReviewChanges}</div>
            </div>
        `;
    }

    /**
     * Group forms by date
     */
    function groupFormsByDate(forms) {
        const grouped = {};
        forms.forEach(form => {
            const formDate = new Date(form.movedToHistoryDate || form.addedDate);
            const dateStr = formDate.toISOString().split('T')[0];
            if (!grouped[dateStr]) {
                grouped[dateStr] = [];
            }
            grouped[dateStr].push(form);
        });
        return grouped;
    }

    /**
     * Render user forms grouped by date
     */
    function renderUserForms(formsByDate) {
        const container = document.getElementById('user-forms-container');
        container.innerHTML = '';

        // Sort dates descending
        const dates = Object.keys(formsByDate).sort((a, b) => b.localeCompare(a));

        dates.forEach(dateStr => {
            const forms = formsByDate[dateStr];
            const section = document.createElement('div');
            section.className = 'section';

            const date = new Date(dateStr);
            const formattedDate = date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            section.innerHTML = `
                <div class="section-header">
                    <div class="section-title">${formattedDate}</div>
                    <div>${forms.length} form${forms.length !== 1 ? 's' : ''}</div>
                </div>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Policy Number</th>
                                <th>Broker</th>
                                <th>Type</th>
                                <th>Changes</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody id="forms-${dateStr}">
                        </tbody>
                    </table>
                </div>
            `;

            container.appendChild(section);

            // Populate table rows
            const tbody = document.getElementById(`forms-${dateStr}`);
            forms.forEach((form, index) => {
                const rows = createFormRow(form, `${dateStr}-${index}`);
                rows.forEach(r => tbody.appendChild(r));
            });
        });
    }

    /**
     * Create a table row for a form
     */
    function createFormRow(form, rowId) {
        const row = document.createElement('tr');

        const changes = form.fieldChanges || {};
        const reviewChanges = form.reviewModeChanges || {};
        const hasChanges = (changes.totalFieldsChanged || 0) > 0;
        const hasReviewChanges = (reviewChanges.totalFieldsChanged || 0) > 0;
        const totalChanges = (changes.totalFieldsChanged || 0) + (reviewChanges.totalFieldsChanged || 0);

        let changesBadge = '<span class="badge badge-clean">No Changes</span>';
        if (totalChanges > 0) {
            changesBadge = `<span class="badge badge-changes">${totalChanges} field${totalChanges !== 1 ? 's' : ''}</span>`;
            // Add sub-badges if both types exist
            if (hasChanges && hasReviewChanges) {
                changesBadge += ` <span class="badge badge-sub">${changes.totalFieldsChanged} initial</span> <span class="badge badge-sub badge-review">${reviewChanges.totalFieldsChanged} review</span>`;
            }
        }

        row.innerHTML = `
            <td><a href="${escapeHtml(form.url || '#')}" class="clickable-link" target="_blank">${escapeHtml(form.policyNumber || 'N/A')}</a></td>
            <td>${escapeHtml(form.broker || 'N/A')}</td>
            <td>${escapeHtml(form.policyType || 'N/A')}</td>
            <td>${changesBadge}</td>
            <td>${hasChanges || hasReviewChanges ? `<span class="expandable" data-row-id="${rowId}">View Details</span>` : '-'}</td>
        `;

        // Add details row if there are changes
        if (hasChanges || hasReviewChanges) {
            const detailsRow = document.createElement('tr');
            detailsRow.innerHTML = `
                <td colspan="5">
                    <div class="change-details" id="details-${rowId}">
                        ${renderChangeDetails(changes, reviewChanges)}
                    </div>
                </td>
            `;

            // Add click handler to expandable element
            const expandable = row.querySelector('.expandable');
            if (expandable) {
                expandable.addEventListener('click', () => {
                    expandable.classList.toggle('expanded');
                    const details = detailsRow.querySelector('.change-details');
                    if (details) {
                        details.classList.toggle('visible');
                    }
                });
            }

            return [row, detailsRow];
        }

        return [row];
    }

    /**
     * Render change details for a form
     */
    function renderChangeDetails(changes, reviewChanges) {
        let html = '';

        if (changes.stepsWithChanges && changes.stepsWithChanges.length > 0) {
            changes.stepsWithChanges.forEach(step => {
                html += `
                    <div class="change-step">
                        <div class="change-step-name">${escapeHtml(step.stepName)} (${step.fieldCount} field${step.fieldCount !== 1 ? 's' : ''})</div>
                        <div class="change-fields">Changed fields: ${step.changedFields.map(f => escapeHtml(f)).join(', ')}</div>
                    </div>
                `;
            });
        }

        if (reviewChanges.stepsWithChanges && reviewChanges.stepsWithChanges.length > 0) {
            reviewChanges.stepsWithChanges.forEach(step => {
                html += `
                    <div class="change-step change-step-review">
                        <div class="change-step-name">
                            <span class="review-indicator">🔍 Review</span>
                            ${escapeHtml(step.stepName)} (${step.fieldCount} field${step.fieldCount !== 1 ? 's' : ''})
                        </div>
                        <div class="change-fields">Changed fields: ${step.changedFields.map(f => escapeHtml(f)).join(', ')}</div>
                    </div>
                `;
            });
        }

        return html || '<div>No change details available</div>';
    }

    /**
     * Load and render broker analysis
     */
    function loadBrokerAnalysis() {
        const container = document.getElementById('broker-charts-container');
        const summaryContainer = document.getElementById('broker-summary');

        container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading broker analysis...</div></div>';
        summaryContainer.innerHTML = '';

        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            const startDate = brokerFilters.startDate || document.getElementById('broker-start-date').value;
            const endDate = brokerFilters.endDate || document.getElementById('broker-end-date').value;
            const selectedBroker = brokerFilters.broker || 'all';

            // Filter forms by date range
            let filteredForms = history.filter(form => {
                const formDate = new Date(form.movedToHistoryDate || form.addedDate);
                const dateStr = formDate.toISOString().split('T')[0];
                return dateStr >= startDate && dateStr <= endDate;
            });

            // Filter by broker if not "all"
            if (selectedBroker !== 'all') {
                filteredForms = filteredForms.filter(form => form.broker === selectedBroker);
            }

            // Populate broker dropdown
            populateBrokerDropdown(history);

            // Calculate broker statistics
            const stats = calculateBrokerStats(filteredForms, selectedBroker);
            renderBrokerSummary(stats);

            // Render detailed breakdown
            renderDetailedBreakdown(filteredForms, 'broker');

            renderBrokerCharts(stats);
        });
    }

    /**
     * Populate broker dropdown with unique brokers from history
     */
    function populateBrokerDropdown(history) {
        const select = document.getElementById('broker-select');
        const currentValue = select.value;

        // Get unique brokers
        const brokers = [...new Set(history.map(form => form.broker).filter(b => b))].sort();

        // Clear and repopulate (keep "All Brokers" option)
        select.innerHTML = '<option value="all">All Brokers</option>';
        brokers.forEach(broker => {
            const option = document.createElement('option');
            option.value = broker;
            option.textContent = broker;
            select.appendChild(option);
        });

        // Restore previous selection if it exists
        if (currentValue && Array.from(select.options).some(opt => opt.value === currentValue)) {
            select.value = currentValue;
        }
    }

    /**
     * Calculate broker statistics
     */
    function calculateBrokerStats(forms, broker) {
        const totalForms = forms.length;
        let formsWithChanges = 0;
        let totalFieldsChanged = 0;
        let stepCounts = {}; // { stepName: { count, totalFields } }
        let fieldCounts = {}; // { stepName: { fieldName: count } }

        forms.forEach(form => {
            const changes = form.fieldChanges || {};
            if (changes.totalFieldsChanged > 0) {
                formsWithChanges++;
                totalFieldsChanged += changes.totalFieldsChanged;
            }

            if (changes.stepsWithChanges) {
                changes.stepsWithChanges.forEach(step => {
                    // Count step occurrences
                    if (!stepCounts[step.stepName]) {
                        stepCounts[step.stepName] = { count: 0, totalFields: 0 };
                    }
                    stepCounts[step.stepName].count++;
                    stepCounts[step.stepName].totalFields += step.fieldCount;

                    // Count field occurrences within each step
                    if (!fieldCounts[step.stepName]) {
                        fieldCounts[step.stepName] = {};
                    }
                    step.changedFields.forEach(fieldName => {
                        fieldCounts[step.stepName][fieldName] = (fieldCounts[step.stepName][fieldName] || 0) + 1;
                    });
                });
            }
        });

        // Convert to sorted arrays
        const sortedSteps = Object.entries(stepCounts)
            .map(([name, data]) => ({ name, count: data.count, totalFields: data.totalFields }))
            .sort((a, b) => b.count - a.count);

        const stepFieldBreakdown = {};
        Object.entries(fieldCounts).forEach(([stepName, fields]) => {
            stepFieldBreakdown[stepName] = Object.entries(fields)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);
        });

        return {
            broker: broker === 'all' ? 'All Brokers' : broker,
            totalForms,
            formsWithChanges,
            changesPercent: totalForms > 0 ? Math.round((formsWithChanges / totalForms) * 100) : 0,
            totalFieldsChanged,
            avgFieldsPerForm: totalForms > 0 ? (totalFieldsChanged / totalForms).toFixed(1) : 0,
            sortedSteps,
            stepFieldBreakdown
        };
    }

    /**
     * Render broker summary cards
     */
    function renderBrokerSummary(stats) {
        const container = document.getElementById('broker-summary');
        container.innerHTML = `
            <div class="summary-card">
                <div class="summary-card-label">Total Forms</div>
                <div class="summary-card-value">${stats.totalForms}</div>
                <div class="summary-card-subtext">${stats.broker}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">Forms with Changes</div>
                <div class="summary-card-value">${stats.formsWithChanges}</div>
                <div class="summary-card-subtext">${stats.changesPercent}% of total</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">Total Fields Changed</div>
                <div class="summary-card-value">${stats.totalFieldsChanged}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">Avg. Changes per Form</div>
                <div class="summary-card-value">${stats.avgFieldsPerForm}</div>
            </div>
        `;
    }

    /**
     * Render broker analysis charts
     */
    function renderBrokerCharts(stats) {
        const container = document.getElementById('broker-charts-container');

        if (stats.sortedSteps.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📈</div>
                    <div class="empty-state-text">No changes detected</div>
                    <div class="empty-state-subtext">No forms with field changes in this selection</div>
                </div>
            `;
            return;
        }

        // Render most frequently changed steps chart
        const maxCount = Math.max(...stats.sortedSteps.map(s => s.count));
        let html = `
            <div class="section">
                <div class="section-header">
                    <div class="section-title">Most Frequently Changed Steps</div>
                </div>
                <div class="bar-chart">
        `;

        stats.sortedSteps.forEach(step => {
            const percentage = maxCount > 0 ? (step.count / maxCount) * 100 : 0;
            html += `
                <div class="bar-row">
                    <div class="bar-label">
                        <span>${escapeHtml(step.name)}</span>
                        <span>${step.count} form${step.count !== 1 ? 's' : ''} (${step.totalFields} field${step.totalFields !== 1 ? 's' : ''})</span>
                    </div>
                    <div class="bar-background">
                        <div class="bar-fill" style="width: ${percentage}%">
                            ${step.count}
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        // Render field breakdown for each step
        Object.entries(stats.stepFieldBreakdown).forEach(([stepName, fields]) => {
            if (fields.length > 0) {
                const maxFieldCount = Math.max(...fields.map(f => f.count));
                html += `
                    <div class="section">
                        <div class="section-header">
                            <div class="section-title">Field Changes: ${escapeHtml(stepName)}</div>
                        </div>
                        <div class="bar-chart">
                `;

                fields.slice(0, 10).forEach(field => { // Show top 10 fields
                    const percentage = maxFieldCount > 0 ? (field.count / maxFieldCount) * 100 : 0;
                    html += `
                        <div class="bar-row">
                            <div class="bar-label">
                                <span>${escapeHtml(field.name)}</span>
                                <span>${field.count} change${field.count !== 1 ? 's' : ''}</span>
                            </div>
                            <div class="bar-background">
                                <div class="bar-fill" style="width: ${percentage}%">
                                    ${field.count}
                                </div>
                            </div>
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            }
        });

        container.innerHTML = html;
    }

    /**
     * Render detailed step and field breakdown
     */
    function renderDetailedBreakdown(forms, reportType) {
        const tbodyId = reportType === 'user' ? 'user-breakdown-tbody' : 'broker-breakdown-tbody';
        const tbody = document.getElementById(tbodyId);

        if (!tbody) return;

        // Collect all step and field data
        const stepData = {}; // { stepName: { count, fieldData: { fieldName: count } } }
        const totalForms = forms.length;

        forms.forEach(form => {
            const changes = form.fieldChanges || {};
            if (changes.stepsWithChanges) {
                changes.stepsWithChanges.forEach(step => {
                    if (!stepData[step.stepName]) {
                        stepData[step.stepName] = { count: 0, fieldData: {} };
                    }
                    stepData[step.stepName].count++;

                    step.changedFields.forEach(fieldName => {
                        if (!stepData[step.stepName].fieldData[fieldName]) {
                            stepData[step.stepName].fieldData[fieldName] = 0;
                        }
                        stepData[step.stepName].fieldData[fieldName]++;
                    });
                });
            }
        });

        // Sort steps by count (descending)
        const sortedSteps = Object.entries(stepData)
            .map(([name, data]) => ({ name, count: data.count, fieldData: data.fieldData }))
            .sort((a, b) => b.count - a.count);

        // Render table
        tbody.innerHTML = '';

        if (sortedSteps.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #a0aec0; padding: 40px;">No changes detected in this selection</td></tr>';
            return;
        }

        sortedSteps.forEach((step, stepIndex) => {
            const stepPercentage = totalForms > 0 ? ((step.count / totalForms) * 100).toFixed(1) : 0;
            const stepId = `${reportType}-step-${stepIndex}`;

            // Step row
            const stepRow = document.createElement('tr');
            stepRow.className = 'breakdown-step-row';
            stepRow.dataset.stepId = stepId;
            stepRow.innerHTML = `
                <td>
                    <span class="toggle-icon">▶</span>
                    <strong>${escapeHtml(step.name)}</strong>
                </td>
                <td>${step.count}</td>
                <td>${stepPercentage}%</td>
                <td><span class="percentage-bar" style="width: ${Math.min(stepPercentage * 2, 200)}px"></span></td>
            `;
            tbody.appendChild(stepRow);

            // Add click handler to toggle fields
            stepRow.addEventListener('click', () => {
                const icon = stepRow.querySelector('.toggle-icon');
                icon.classList.toggle('expanded');

                // Toggle field rows
                const fieldRows = tbody.querySelectorAll(`tr[data-parent="${stepId}"]`);
                fieldRows.forEach(row => row.classList.toggle('hidden'));
            });

            // Field rows (hidden by default)
            const sortedFields = Object.entries(step.fieldData)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);

            sortedFields.forEach(field => {
                const fieldPercentage = totalForms > 0 ? ((field.count / totalForms) * 100).toFixed(1) : 0;
                const fieldRow = document.createElement('tr');
                fieldRow.className = 'breakdown-field-row hidden';
                fieldRow.dataset.parent = stepId;
                fieldRow.innerHTML = `
                    <td>${escapeHtml(field.name)}</td>
                    <td>${field.count}</td>
                    <td>${fieldPercentage}%</td>
                    <td><span class="percentage-bar" style="width: ${Math.min(fieldPercentage * 2, 200)}px"></span></td>
                `;
                tbody.appendChild(fieldRow);
            });
        });

        // Add sorting to headers
        const table = tbody.closest('table');
        const headers = table.querySelectorAll('th.sortable');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                sortBreakdownTable(tbody, header.dataset.sort, reportType);
            });
        });

        // Store data for export
        if (reportType === 'user') {
            window.userBreakdownData = sortedSteps;
        } else {
            window.brokerBreakdownData = sortedSteps;
        }
    }

    /**
     * Sort breakdown table by column
     */
    function sortBreakdownTable(tbody, sortBy, reportType) {
        const rows = Array.from(tbody.querySelectorAll('tr.breakdown-step-row'));

        rows.sort((a, b) => {
            let valA, valB;

            if (sortBy === 'name') {
                valA = a.querySelector('strong').textContent.toLowerCase();
                valB = b.querySelector('strong').textContent.toLowerCase();
                return valA.localeCompare(valB);
            } else if (sortBy === 'count') {
                valA = parseInt(a.cells[1].textContent);
                valB = parseInt(b.cells[1].textContent);
                return valB - valA; // Descending
            } else if (sortBy === 'percentage') {
                valA = parseFloat(a.cells[2].textContent);
                valB = parseFloat(b.cells[2].textContent);
                return valB - valA; // Descending
            }

            return 0;
        });

        // Re-append rows in new order
        rows.forEach(row => {
            const stepId = row.dataset.stepId;
            tbody.appendChild(row);

            // Re-append field rows after parent
            const fieldRows = tbody.querySelectorAll(`tr[data-parent="${stepId}"]`);
            fieldRows.forEach(fieldRow => {
                tbody.appendChild(fieldRow);
            });
        });
    }

    /**
     * Export breakdown data to CSV
     */
    function exportBreakdownToCSV(reportType) {
        const data = reportType === 'user' ? window.userBreakdownData : window.brokerBreakdownData;

        if (!data || data.length === 0) {
            alert('No data to export');
            return;
        }

        // Build CSV content
        let csv = 'Type,Step/Field Name,Change Count,Percentage of Forms\n';

        data.forEach(step => {
            const stepPercentage = ((step.count / data.totalForms) * 100).toFixed(1);
            csv += `Step,"${step.name}",${step.count},${stepPercentage}%\n`;

            const sortedFields = Object.entries(step.fieldData)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);

            sortedFields.forEach(field => {
                const fieldPercentage = ((field.count / data.totalForms) * 100).toFixed(1);
                csv += `Field,"${field.name}",${field.count},${fieldPercentage}%\n`;
            });
        });

        // Create download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `changes-breakdown-${reportType}-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Load and render review mode mistakes
     */
    function loadReviewMistakes() {
        const summaryContainer = document.getElementById('review-summary');
        const formsContainer = document.getElementById('review-forms-list');

        summaryContainer.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading review mistakes...</div></div>';
        formsContainer.innerHTML = '';

        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];

            // Get date filters
            const startDate = document.getElementById('review-start-date').value;
            const endDate = document.getElementById('review-end-date').value;

            // Filter forms with review mode changes
            const formsWithReviewChanges = history.filter(form => {
                if (!form.reviewModeChanges || form.reviewModeChanges.totalFieldsChanged === 0) {
                    return false;
                }

                // Apply date filter
                if (startDate && form.completedDate && form.completedDate < startDate) return false;
                if (endDate && form.completedDate && form.completedDate > endDate) return false;

                return true;
            });

            // Calculate summary stats
            const totalForms = formsWithReviewChanges.length;
            const totalMistakes = formsWithReviewChanges.reduce((sum, form) =>
                sum + (form.reviewModeChanges.totalFieldsChanged || 0), 0);
            const avgMistakesPerForm = totalForms > 0 ? (totalMistakes / totalForms).toFixed(1) : 0;

            // Group by step
            const mistakesByStep = {};
            formsWithReviewChanges.forEach(form => {
                if (form.reviewModeChanges && form.reviewModeChanges.stepsWithChanges) {
                    form.reviewModeChanges.stepsWithChanges.forEach(step => {
                        if (!mistakesByStep[step.stepName]) {
                            mistakesByStep[step.stepName] = 0;
                        }
                        mistakesByStep[step.stepName] += step.fieldCount;
                    });
                }
            });

            // Render summary
            summaryContainer.innerHTML = `
                <div class="summary-card">
                    <div class="summary-value">${totalForms}</div>
                    <div class="summary-label">Forms with Mistakes</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${totalMistakes}</div>
                    <div class="summary-label">Total Mistakes Caught</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${avgMistakesPerForm}</div>
                    <div class="summary-label">Avg Mistakes per Form</div>
                </div>
            `;

            // Render forms list
            if (totalForms === 0) {
                formsContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">✅</div>
                        <div class="empty-state-text">No mistakes found!</div>
                        <div class="empty-state-subtext">All forms were processed correctly on the first pass.</div>
                    </div>
                `;
                return;
            }

            // Group by date
            const formsByDate = {};
            formsWithReviewChanges.forEach(form => {
                const date = form.completedDate || 'Unknown';
                if (!formsByDate[date]) {
                    formsByDate[date] = [];
                }
                formsByDate[date].push(form);
            });

            // Sort dates descending
            const sortedDates = Object.keys(formsByDate).sort().reverse();

            sortedDates.forEach(date => {
                const forms = formsByDate[date];
                const section = document.createElement('div');
                section.className = 'date-section';
                section.innerHTML = `
                    <div class="date-header">${date} (${forms.length} form${forms.length !== 1 ? 's' : ''})</div>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Policy Number</th>
                                    <th>Broker</th>
                                    <th>Type</th>
                                    <th>Mistakes</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody id="review-forms-${date.replace(/\//g, '-')}">
                            </tbody>
                        </table>
                    </div>
                `;

                formsContainer.appendChild(section);

                const tbody = document.getElementById(`review-forms-${date.replace(/\//g, '-')}`);
                forms.forEach((form, index) => {
                    const rowId = `review-${date}-${index}`;
                    const reviewChanges = form.reviewModeChanges || {};

                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td><a href="${escapeHtml(form.url || '#')}" class="clickable-link" target="_blank">${escapeHtml(form.policyNumber || 'N/A')}</a></td>
                        <td>${escapeHtml(form.broker || 'N/A')}</td>
                        <td>${escapeHtml(form.policyType || 'N/A')}</td>
                        <td><span class="badge badge-review">${reviewChanges.totalFieldsChanged} field${reviewChanges.totalFieldsChanged !== 1 ? 's' : ''}</span></td>
                        <td><span class="expandable" data-row-id="${rowId}">View Details</span></td>
                    `;

                    const detailsRow = document.createElement('tr');
                    detailsRow.innerHTML = `
                        <td colspan="5">
                            <div class="change-details" id="details-${rowId}">
                                ${renderReviewMistakeDetails(reviewChanges)}
                            </div>
                        </td>
                    `;

                    // Add click handler
                    const expandable = row.querySelector('.expandable');
                    if (expandable) {
                        expandable.addEventListener('click', () => {
                            expandable.classList.toggle('expanded');
                            const details = detailsRow.querySelector('.change-details');
                            if (details) {
                                details.classList.toggle('visible');
                            }
                        });
                    }

                    tbody.appendChild(row);
                    tbody.appendChild(detailsRow);
                });
            });
        });
    }

    /**
     * Render review mistake details
     */
    function renderReviewMistakeDetails(reviewChanges) {
        let html = '';

        if (reviewChanges.stepsWithChanges && reviewChanges.stepsWithChanges.length > 0) {
            reviewChanges.stepsWithChanges.forEach(step => {
                html += `
                    <div class="change-step">
                        <div class="change-step-name">${escapeHtml(step.stepName)} (${step.fieldCount} mistake${step.fieldCount !== 1 ? 's' : ''})</div>
                        <div class="change-fields">Fields corrected: ${step.changedFields.map(f => escapeHtml(f)).join(', ')}</div>
                    </div>
                `;
            });
        }

        return html || '<div>No details available</div>';
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    console.log(LOG_PREFIX, "Changes report script loaded");
})();
