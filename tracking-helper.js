/**
 * tracking-helper.js
 * Provides tracking integration for the ProcessingChecklist extension
 * This file is included in content.js and provides functions for form detection,
 * progress tracking, and review mode management.
 */

(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    const LOG_PREFIX = "[ProcessingChecklist-Tracking]";

    // Storage limits
    const MAX_HISTORY_ITEMS = 500; // Maximum items to keep in history
    const MAX_HISTORY_AGE_DAYS = 90; // Maximum age for history items (90 days)
    const PRUNE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Check daily (24 hours)

    // Tracking state
    window.trackingHelper = {
        currentUrlId: null,
        isReviewMode: false,
        formIsComplete: false,  // True if form is 100% complete or manually marked - prevents checkedProgress updates
        submissionNumber: null,
        updateMetadata: updateTrackingMetadata,
        getSavedProgress: null,  // Will be set by content.js to retrieve saved progress
        getChecklistTotal: null,  // Will be set by content.js to get checklist length
        pruneHistory: pruneHistory,  // Exposed for manual pruning
        exportHistory: exportHistory  // Exposed for exporting before pruning
    };

    /**
     * Normalize policy number for comparison (remove spaces, slashes, dashes)
     */
    function normalizePolicyNumber(policyNumber) {
        if (!policyNumber) return '';
        return policyNumber.replace(/[\s\-\/]/g, '').toUpperCase();
    }

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
            'BN': 'Backout of New Business',
            'BR': 'Backout of Renewal',
            'BX': 'Backout of Extension',
            'BE': 'Backout of Endorsement',
            'BA': 'Backout of Audit',
            'BC': 'Backout of Cancellation'
        };

        return typeMap[upperCode] || code;
    }

    /**
     * Map transaction type dropdown value to letter code
     */
    function mapTransactionTypeToCode(transactionType) {
        if (!transactionType) return '';

        const typeMap = {
            'New Business': 'N',
            'Renewal': 'R',
            'Extension': 'X',
            'Endorsement': 'E',
            'Audit': 'A',
            'Cancellation': 'C',
            'Backout of New Business': 'BN',
            'Backout of Renewal': 'BR',
            'Backout of Extension': 'BX',
            'Backout of Endorsement': 'BE',
            'Backout of Audit': 'BA',
            'Backout of Cancellation': 'BC'
        };

        return typeMap[transactionType] || transactionType;
    }

    /**
     * Get simplified backout code (B for all backouts)
     */
    function getSimplifiedBackoutCode(code) {
        if (!code) return code;
        if (code.toUpperCase().startsWith('B') && code.length > 1) {
            return 'B';
        }
        return code;
    }

    /**
     * Extract URL ID from current page URL
     * Normalizes by removing leading zeros for consistent comparison
     */
    function extractUrlId() {
        const url = window.location.href;

        // Pattern 1: /Policy/TransactionDetails/Edit/019579767?doc=open
        const editMatch = url.match(/\/Edit\/(\d+)/);
        if (editMatch) {
            // Remove leading zeros to normalize (e.g., "019617801" becomes "19617801")
            return String(parseInt(editMatch[1], 10));
        }

        return null;
    }

    /**
     * Extract submission number from page (with caching)
     */
    function extractSubmissionNumber() {
        if (!window.ProcessingChecklistUtils) {
            // Fallback if utils not loaded
            const elem = document.querySelector('#LaunchSubmissionInfoModal');
            return elem ? elem.textContent.trim() : null;
        }
        const elem = window.ProcessingChecklistUtils.SelectorCache.get('#LaunchSubmissionInfoModal');
        if (elem) {
            return elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract policy number from page (with caching)
     */
    function extractPolicyNumber() {
        if (!window.ProcessingChecklistUtils) {
            const elem = document.querySelector('#PolicyNumber');
            return elem ? (elem.value ? elem.value.trim() : elem.textContent.trim()) : null;
        }
        const elem = window.ProcessingChecklistUtils.SelectorCache.get('#PolicyNumber');
        if (elem) {
            return elem.value ? elem.value.trim() : elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract primary insured from page (with caching)
     */
    function extractPrimaryInsured() {
        if (!window.ProcessingChecklistUtils) {
            const elem = document.querySelector('#PrimaryInsuredName');
            return elem ? (elem.value ? elem.value.trim() : elem.textContent.trim()) : null;
        }
        const elem = window.ProcessingChecklistUtils.SelectorCache.get('#PrimaryInsuredName');
        if (elem) {
            return elem.value ? elem.value.trim() : elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract total taxable premium from page (with caching)
     */
    function extractTotalTaxablePremium() {
        if (!window.ProcessingChecklistUtils) {
            const elem = document.querySelector('#taxablePremium');
            return elem ? elem.textContent.trim() : null;
        }
        const elem = window.ProcessingChecklistUtils.SelectorCache.get('#taxablePremium');
        if (elem) {
            return elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract transaction type from page (with caching)
     */
    function extractTransactionType() {
        if (!window.ProcessingChecklistUtils) {
            const elem = document.querySelector('#TransactionTypeId');
            if (elem) {
                const selectedOption = elem.options[elem.selectedIndex];
                return selectedOption ? selectedOption.text.trim() : null;
            }
            return null;
        }
        const elem = window.ProcessingChecklistUtils.SelectorCache.get('#TransactionTypeId');
        if (elem) {
            // Get the selected option text
            const selectedOption = elem.options[elem.selectedIndex];
            return selectedOption ? selectedOption.text.trim() : null;
        }
        return null;
    }

    /**
     * Update all tracking metadata for current form
     */
    function updateTrackingMetadata() {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId) return;

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                let updated = false;

                // Update policy number
                const policyNumber = extractPolicyNumber();
                if (policyNumber && policyNumber !== history[index].policyNumber) {
                    history[index].policyNumber = policyNumber;
                    updated = true;
                }

                // Update primary insured
                const primaryInsured = extractPrimaryInsured();
                if (primaryInsured && primaryInsured !== history[index].primaryNamedInsured) {
                    history[index].primaryNamedInsured = primaryInsured;
                    updated = true;
                }

                // Update total taxable premium
                const premium = extractTotalTaxablePremium();
                if (premium && premium !== history[index].totalTaxablePremium) {
                    history[index].totalTaxablePremium = premium;
                    updated = true;
                }

                // Update transaction type and track changes (excluding backouts)
                const transactionType = extractTransactionType();
                if (transactionType) {
                    const currentTypeCode = mapTransactionTypeToCode(transactionType);
                    const originalTypeCode = history[index].originalPolicyType || history[index].policyType;

                    // Don't track backout changes
                    const isBackout = currentTypeCode.toUpperCase().startsWith('B') && currentTypeCode.length > 1;

                    if (!isBackout && currentTypeCode !== history[index].policyType) {
                        // First time setting the type
                        if (!history[index].originalPolicyType && history[index].policyType) {
                            history[index].originalPolicyType = history[index].policyType;
                        }

                        history[index].policyType = currentTypeCode;
                        updated = true;

                        console.log(LOG_PREFIX, `Transaction type changed from ${originalTypeCode} to ${currentTypeCode}`);
                    }
                }

                if (updated) {
                    ext.storage.local.set({ tracking_history: history });
                    console.log(LOG_PREFIX, "Metadata updated for form:", urlId);
                }
            }
        });
    }

    /**
     * Detect if current page is a tracked form and move from Available to History
     */
    window.trackingHelper.detectAndRegisterForm = function() {
        // Skip detection if this is a background download tab (has doc=open)
        if (window.location.href.includes('doc=open')) {
            console.log(LOG_PREFIX, "Skipping form detection - this is a background download tab");
            return;
        }

        const urlId = extractUrlId();
        if (!urlId) {
            return; // Not a tracked form
        }

        window.trackingHelper.currentUrlId = urlId;

        // Wait for page to load submission number
        setTimeout(() => {
            const submissionNumber = extractSubmissionNumber();
            window.trackingHelper.submissionNumber = submissionNumber;

            // Check if this form is in Available Forms
            ext.storage.local.get(['tracking_availableForms', 'tracking_history'], (result) => {
                let availableForms = result.tracking_availableForms || [];
                let history = result.tracking_history || [];

                // Extract current page data for matching
                const currentPolicyNumber = extractPolicyNumber();
                const currentSubmissionNumber = submissionNumber;

                // Find matching form in available forms
                // PRIORITY 1: Match by resolved URL ID (most reliable)
                // PRIORITY 2: For temp_ IDs, match by submission and policy number with type verification
                let formIndex = availableForms.findIndex(f => {
                    // Exact URL ID match (highest priority)
                    if (f.urlId === urlId) return true;

                    // For temp_ IDs (BeginProcessing URLs), match by submission and policy number
                    // This is only used as fallback when URL hasn't been resolved yet
                    if (f.urlId.startsWith('temp_')) {
                        const submissionMatch = currentSubmissionNumber && f.submissionNumber &&
                            currentSubmissionNumber === f.submissionNumber;
                        const policyMatch = currentPolicyNumber && f.policyNumber &&
                            normalizePolicyNumber(currentPolicyNumber) === normalizePolicyNumber(f.policyNumber);

                        return submissionMatch || policyMatch;
                    }

                    return false;
                });

                // Check if already in history first (to avoid removing from queue on refresh)
                // IMPORTANT: Prioritize URL ID matching over policy number to handle multiple
                // transactions (New Business, Endorsement, etc.) on the same policy
                const existingHistoryIndex = history.findIndex(h => {
                    // Exact URL ID match (highest priority - this uniquely identifies the form)
                    if (h.urlId === urlId) return true;

                    // DO NOT match by policy number alone - this causes issues when the same
                    // policy has multiple transactions (New Business, Endorsement, etc.)
                    // Only match by policy number if this is a temp ID and we have both
                    // submission number AND policy number matching
                    if (urlId.startsWith('temp_') && currentSubmissionNumber && currentPolicyNumber && h.policyNumber) {
                        const submissionMatch = h.submissionNumber && currentSubmissionNumber === h.submissionNumber;
                        const policyMatch = normalizePolicyNumber(currentPolicyNumber) === normalizePolicyNumber(h.policyNumber);
                        return submissionMatch && policyMatch;
                    }

                    return false;
                });

                if (formIndex !== -1 && existingHistoryIndex === -1) {
                    // Found in queue AND not in history - move from queue to history
                    const form = availableForms[formIndex];

                    // Update URL ID if this was a temp ID
                    if (form.urlId.startsWith('temp_')) {
                        console.log(LOG_PREFIX, `Updating temp ID ${form.urlId} to real ID ${urlId}`);
                        form.urlId = urlId;
                        // Preserve doc=open flag by reconstructing URL with current location base
                        const currentUrl = new URL(window.location.href);
                        const originalUrl = new URL(form.url);
                        // Keep the original query parameters (like doc=open) but use the new path
                        currentUrl.search = originalUrl.search;
                        form.url = currentUrl.href;
                    }

                    // Update submission number if extracted
                    if (submissionNumber) {
                        form.submissionNumber = submissionNumber;
                    }

                    // Remove from available
                    availableForms.splice(formIndex, 1);

                    // Extract metadata from page
                    const policyNumber = extractPolicyNumber() || form.policyNumber;
                    const primaryInsured = extractPrimaryInsured();
                    const pagePremium = extractTotalTaxablePremium();
                    const totalPremium = pagePremium || form.premium;
                    const transactionType = extractTransactionType();
                    const typeCode = transactionType ? mapTransactionTypeToCode(transactionType) : form.policyType;

                    // Get checklist total from content.js
                    const checklistTotal = (window.trackingHelper.getChecklistTotal && window.trackingHelper.getChecklistTotal()) || 0;

                    // Add to history with initial progress
                    history.push({
                        ...form,
                        policyNumber: policyNumber,
                        policyType: typeCode,
                        checkedProgress: { current: 0, total: checklistTotal, percentage: 0 },
                        reviewedProgress: null,
                        manuallyMarkedComplete: false,
                        primaryNamedInsured: primaryInsured,
                        totalTaxablePremium: totalPremium,
                        addedDate: form.addedDate || new Date().toISOString(),
                        movedToHistoryDate: new Date().toISOString(),
                        completedDate: null
                    });

                    // Save changes
                    ext.storage.local.set({
                        tracking_availableForms: availableForms,
                        tracking_history: history
                    });

                    // New form is not complete
                    window.trackingHelper.formIsComplete = false;

                    console.log(LOG_PREFIX, "Form detected and moved to history:", urlId);
                } else if (existingHistoryIndex !== -1) {
                    // Already in history - check if completed to determine if we should update progress
                    const existingForm = history[existingHistoryIndex];
                    const isComplete = existingForm.manuallyMarkedComplete ||
                                      (existingForm.checkedProgress && existingForm.checkedProgress.percentage === 100);

                    if (!existingForm.movedToHistoryDate) {
                        existingForm.movedToHistoryDate = new Date().toISOString();
                    }

                    // Update metadata on reconnect
                    const policyNumber = extractPolicyNumber();
                    const primaryInsured = extractPrimaryInsured();
                    const totalPremium = extractTotalTaxablePremium();

                    if (policyNumber) existingForm.policyNumber = policyNumber;
                    if (primaryInsured) existingForm.primaryNamedInsured = primaryInsured;
                    if (totalPremium) existingForm.totalTaxablePremium = totalPremium;

                    ext.storage.local.set({ tracking_history: history });

                    if (isComplete) {
                        console.log(LOG_PREFIX, "Reconnected to completed form - checkedProgress will remain frozen:", urlId);
                        // Set flag to prevent updateProgress from modifying checkedProgress
                        window.trackingHelper.formIsComplete = true;
                    } else {
                        console.log(LOG_PREFIX, "Reconnected to incomplete form - checkedProgress can be updated:", urlId);
                        window.trackingHelper.formIsComplete = false;
                    }
                } else {
                    // Not in queue and not in history - this is a new form opened directly
                    // Add directly to history
                    const policyNumber = extractPolicyNumber();
                    const primaryInsured = extractPrimaryInsured();
                    const totalPremium = extractTotalTaxablePremium();
                    const transactionType = extractTransactionType();

                    if (policyNumber) {
                        // Add doc=open to the URL if not already present
                        let formUrl = window.location.href;
                        if (!formUrl.includes('doc=open')) {
                            const url = new URL(formUrl);
                            url.searchParams.set('doc', 'open');
                            formUrl = url.href;
                        }

                        // Convert transaction type to letter code
                        const typeCode = transactionType ? mapTransactionTypeToCode(transactionType) : '';

                        // Get checklist total from content.js
                        const checklistTotal = (window.trackingHelper.getChecklistTotal && window.trackingHelper.getChecklistTotal()) || 0;

                        history.push({
                            urlId: urlId,
                            url: formUrl,
                            policyNumber: policyNumber,
                            submissionNumber: submissionNumber || '',
                            premium: totalPremium || '',
                            broker: '',
                            policyType: typeCode,
                            checkedProgress: { current: 0, total: checklistTotal, percentage: 0 },
                            reviewedProgress: null,
                            manuallyMarkedComplete: false,
                            primaryNamedInsured: primaryInsured,
                            totalTaxablePremium: totalPremium,
                            addedDate: new Date().toISOString(),
                            movedToHistoryDate: new Date().toISOString(),
                            completedDate: null
                        });
                        ext.storage.local.set({ tracking_history: history });

                        // New form is not complete
                        window.trackingHelper.formIsComplete = false;

                        console.log(LOG_PREFIX, "New form auto-added to history:", urlId, "Type:", typeCode);
                    }
                }
            });
        }, 500);
    };

    /**
     * Update progress tracking in history
     */
    window.trackingHelper.updateProgress = function(checkedCurrent, checkedTotal, isReview = false) {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId) return;

        const percentage = checkedTotal > 0 ? Math.round((checkedCurrent / checkedTotal) * 100) : 0;

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                if (isReview) {
                    // Always allow reviewedProgress updates
                    history[index].reviewedProgress = {
                        current: checkedCurrent,
                        total: checkedTotal,
                        percentage: percentage
                    };
                } else {
                    // Only update checkedProgress if form is not already complete
                    if (!window.trackingHelper.formIsComplete) {
                        history[index].checkedProgress = {
                            current: checkedCurrent,
                            total: checkedTotal,
                            percentage: percentage
                        };

                        // Update completed date if reaching 100%
                        if (percentage === 100 && !history[index].completedDate) {
                            history[index].completedDate = new Date().toISOString();
                        }

                        ext.storage.local.set({ tracking_history: history });
                        console.log(LOG_PREFIX, `Progress updated: ${checkedCurrent}/${checkedTotal} (${percentage}%)`);
                    } else {
                        console.log(LOG_PREFIX, `Skipping checkedProgress update - form is complete (frozen at ${history[index].checkedProgress.percentage}%)`);
                    }
                    return; // Exit early for non-review mode
                }

                ext.storage.local.set({ tracking_history: history });
                console.log(LOG_PREFIX, `Review progress updated: ${checkedCurrent}/${checkedTotal} (${percentage}%)`);
            }
        });
    };

    /**
     * Update policy number when confirmed in checklist
     */
    window.trackingHelper.updatePolicyNumber = function(policyNumber) {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId || !policyNumber) return;

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                history[index].policyNumber = policyNumber;
                ext.storage.local.set({ tracking_history: history });
                console.log(LOG_PREFIX, "Policy number updated:", policyNumber);
            }
        });
    };

    /**
     * Update primary named insured when confirmed
     */
    window.trackingHelper.updatePrimaryInsured = function(primaryInsured) {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId || !primaryInsured) return;

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                history[index].primaryNamedInsured = primaryInsured;
                ext.storage.local.set({ tracking_history: history });
                console.log(LOG_PREFIX, "Primary insured updated:", primaryInsured);
            }
        });
    };

    /**
     * Update total taxable premium when confirmed
     */
    window.trackingHelper.updatePremium = function(premium) {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId || !premium) return;

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                history[index].totalTaxablePremium = premium;
                ext.storage.local.set({ tracking_history: history });
                console.log(LOG_PREFIX, "Premium updated:", premium);
            }
        });
    };

    /**
     * Enter review mode
     */
    window.trackingHelper.enterReviewMode = function() {
        window.trackingHelper.isReviewMode = true;

        // Add review mode indicator to page
        const indicator = document.createElement('div');
        indicator.id = 'review-mode-indicator';
        indicator.textContent = 'REVIEW MODE';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            padding: 8px 20px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 13px;
            z-index: 100000;
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        document.body.appendChild(indicator);

        console.log(LOG_PREFIX, "Entered review mode");
    };

    /**
     * Apply review mode styling (blue instead of green for confirmed items)
     */
    window.trackingHelper.applyReviewStyling = function() {
        // Add CSS override for review mode
        const style = document.createElement('style');
        style.id = 'review-mode-styles';
        style.textContent = `
            /* Review mode: confirmed items use blue instead of green */
            .confirmed-item {
                background-color: #dbeafe !important; /* Light blue background */
                border-left: 4px solid #3b82f6 !important; /* Blue border */
                padding-left: 30px !important;
            }

            /* Review mode: highlight zones use blue */
            .highlight-zone.confirmed {
                background-color: rgba(59, 130, 246, 0.15) !important; /* Light blue */
                border: 2px solid rgba(59, 130, 246, 0.4) !important;
            }

            .highlight-zone-overlay.review-confirmed-zone {
                background-color: rgba(59, 130, 246, 0.15) !important; /* Semi-transparent blue */
                border: 1px solid rgba(59, 130, 246, 0.3) !important;
            }
        `;
        document.head.appendChild(style);
    };

    /**
     * Get next available form URL
     */
    window.trackingHelper.getNextFormUrl = function(callback) {
        ext.storage.local.get('tracking_availableForms', (result) => {
            const forms = result.tracking_availableForms || [];
            if (forms.length > 0) {
                callback(forms[0].url);
            } else {
                callback(null);
            }
        });
    };

    /**
     * Check if checklist is complete and return next form button state
     */
    window.trackingHelper.shouldShowNextFormButton = function(callback) {
        // Check if current form is in tracking and has 100% progress
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId) {
            callback(false);
            return;
        }

        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];
            const item = history.find(h => h.urlId === urlId);

            if (!item) {
                callback(false);
                return;
            }

            // Check if complete (manually or 100%)
            const isComplete = item.manuallyMarkedComplete ||
                              (item.checkedProgress && item.checkedProgress.percentage === 100);

            callback(isComplete);
        });
    };

    /**
     * Prune old history items to prevent unlimited storage growth
     * Keeps most recent items and completed items within age limit
     */
    function pruneHistory(options = {}) {
        const maxItems = options.maxItems || MAX_HISTORY_ITEMS;
        const maxAgeDays = options.maxAgeDays || MAX_HISTORY_AGE_DAYS;
        const keepCompleted = options.keepCompleted !== false; // Default true

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const originalCount = history.length;

            if (originalCount === 0) {
                console.log(LOG_PREFIX, "No history to prune");
                return;
            }

            const now = Date.now();
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

            // Filter by age - keep items within age limit or completed items if keepCompleted is true
            history = history.filter(item => {
                const itemDate = item.movedToHistoryDate || item.addedDate;
                if (!itemDate) return true; // Keep if no date

                const age = now - new Date(itemDate).getTime();
                const isComplete = item.manuallyMarkedComplete ||
                                  (item.checkedProgress && item.checkedProgress.percentage === 100);

                // Keep if within age limit, or if completed and keepCompleted is true
                return age < maxAgeMs || (keepCompleted && isComplete);
            });

            // If still over limit, sort by date and keep most recent
            if (history.length > maxItems) {
                // Sort by date (most recent first)
                history.sort((a, b) => {
                    const dateA = new Date(b.movedToHistoryDate || b.addedDate || 0);
                    const dateB = new Date(a.movedToHistoryDate || a.addedDate || 0);
                    return dateB - dateA;
                });

                // Keep only maxItems most recent
                history = history.slice(0, maxItems);
            }

            const prunedCount = originalCount - history.length;

            if (prunedCount > 0) {
                ext.storage.local.set({ tracking_history: history }, () => {
                    console.log(LOG_PREFIX, `Pruned ${prunedCount} items from history (${originalCount} → ${history.length})`);

                    // Show notification to user
                    if (typeof window !== 'undefined' && document.body) {
                        showPruneNotification(prunedCount, history.length);
                    }
                });
            } else {
                console.log(LOG_PREFIX, `No pruning needed (${originalCount} items within limits)`);
            }
        });
    }

    /**
     * Export history to JSON file for backup before pruning
     */
    function exportHistory() {
        ext.storage.local.get('tracking_history', (result) => {
            const history = result.tracking_history || [];

            if (history.length === 0) {
                console.log(LOG_PREFIX, "No history to export");
                return;
            }

            const exportData = {
                exportDate: new Date().toISOString(),
                itemCount: history.length,
                history: history
            };

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);

            const filename = `processing-checklist-history-${new Date().toISOString().split('T')[0]}.json`;

            // Use browser download API
            ext.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            }, (downloadId) => {
                console.log(LOG_PREFIX, `History exported: ${filename} (${history.length} items)`);

                // Clean up blob URL after download starts
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            });
        });
    }

    /**
     * Show a temporary notification about pruning
     */
    function showPruneNotification(prunedCount, remainingCount) {
        const notification = document.createElement('div');
        notification.id = 'prune-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: #17a2b8;
            color: white;
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 350px;
            animation: slideInRight 0.3s ease-out;
        `;
        notification.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px;">📋 History Pruned</div>
            <div>Removed ${prunedCount} old items</div>
            <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">${remainingCount} items remaining</div>
        `;
        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    /**
     * Check if pruning is needed and run if necessary
     * Should be called periodically (e.g., on extension load)
     */
    function checkAndPrune() {
        ext.storage.local.get(['tracking_history', 'lastPruneCheck'], (result) => {
            const history = result.tracking_history || [];
            const lastCheck = result.lastPruneCheck || 0;
            const now = Date.now();

            // Check if enough time has passed since last prune check
            if (now - lastCheck < PRUNE_CHECK_INTERVAL) {
                return; // Too soon to check again
            }

            // Update last check time
            ext.storage.local.set({ lastPruneCheck: now });

            // Check if pruning is needed
            if (history.length > MAX_HISTORY_ITEMS) {
                console.log(LOG_PREFIX, `Auto-pruning triggered (${history.length} items)`);
                pruneHistory();
            }
        });
    }

    // Run initial prune check when helper loads
    setTimeout(checkAndPrune, 5000); // Wait 5 seconds after load

    /**
     * Store original field values for change tracking
     * Called when form is first loaded to capture broker-entered values
     */
    window.trackingHelper.storeOriginalValues = function(originalValues) {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId) {
            console.log(LOG_PREFIX, "[ChangeTracking] No urlId, skipping storeOriginalValues");
            return;
        }

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                // Only store original values if they haven't been stored yet
                if (!history[index].originalFieldValues) {
                    history[index].originalFieldValues = originalValues;
                    ext.storage.local.set({ tracking_history: history });
                    console.log(LOG_PREFIX, "[ChangeTracking] Original values stored for", urlId);
                } else {
                    console.log(LOG_PREFIX, "[ChangeTracking] Original values already exist for", urlId);
                }
            }
        });
    };

    /**
     * Store detected field changes
     * Called from content.js when changes are detected
     */
    window.trackingHelper.storeChanges = function(changeData) {
        const urlId = window.trackingHelper.currentUrlId;
        if (!urlId) {
            console.log(LOG_PREFIX, "[ChangeTracking] No urlId, skipping storeChanges");
            return;
        }

        ext.storage.local.get('tracking_history', (result) => {
            let history = result.tracking_history || [];
            const index = history.findIndex(h => h.urlId === urlId);

            if (index !== -1) {
                // Store changes in appropriate property based on review mode
                if (changeData.isReviewMode) {
                    history[index].reviewModeChanges = {
                        stepsWithChanges: changeData.stepsWithChanges,
                        totalStepsWithChanges: changeData.totalStepsWithChanges,
                        totalFieldsChanged: changeData.totalFieldsChanged
                    };
                } else {
                    history[index].fieldChanges = {
                        stepsWithChanges: changeData.stepsWithChanges,
                        totalStepsWithChanges: changeData.totalStepsWithChanges,
                        totalFieldsChanged: changeData.totalFieldsChanged
                    };
                }

                // Update summary
                const normalChanges = history[index].fieldChanges || {};
                const reviewChanges = history[index].reviewModeChanges || {};
                history[index].changesSummary = {
                    totalStepsWithChanges: normalChanges.totalStepsWithChanges || 0,
                    totalFieldsChanged: normalChanges.totalFieldsChanged || 0,
                    reviewModeStepsWithChanges: reviewChanges.totalStepsWithChanges || 0,
                    reviewModeFieldsChanged: reviewChanges.totalFieldsChanged || 0
                };

                ext.storage.local.set({ tracking_history: history });
                console.log(LOG_PREFIX, `[ChangeTracking] Changes stored for ${urlId} (reviewMode=${changeData.isReviewMode}):`, changeData);
            }
        });
    };

    console.log(LOG_PREFIX, "Tracking helper loaded");
})();
