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

    // Tracking state
    window.trackingHelper = {
        currentUrlId: null,
        isReviewMode: false,
        submissionNumber: null,
        updateMetadata: updateTrackingMetadata,
        getSavedProgress: null  // Will be set by content.js to retrieve saved progress
    };

    /**
     * Normalize policy number for comparison (remove spaces, slashes, dashes)
     */
    function normalizePolicyNumber(policyNumber) {
        if (!policyNumber) return '';
        return policyNumber.replace(/[\s\-\/]/g, '').toUpperCase();
    }

    /**
     * Extract URL ID from current page URL
     */
    function extractUrlId() {
        const url = window.location.href;

        // Pattern 1: /Policy/TransactionDetails/Edit/019579767?doc=open
        const editMatch = url.match(/\/Edit\/(\d+)/);
        if (editMatch) {
            return editMatch[1];
        }

        return null;
    }

    /**
     * Extract submission number from page
     */
    function extractSubmissionNumber() {
        const elem = document.querySelector('#LaunchSubmissionInfoModal');
        if (elem) {
            return elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract policy number from page
     */
    function extractPolicyNumber() {
        const elem = document.querySelector('#PolicyNumber');
        if (elem) {
            return elem.value ? elem.value.trim() : elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract primary insured from page
     */
    function extractPrimaryInsured() {
        const elem = document.querySelector('#PrimaryInsuredName');
        if (elem) {
            return elem.value ? elem.value.trim() : elem.textContent.trim();
        }
        return null;
    }

    /**
     * Extract total taxable premium from page
     */
    function extractTotalTaxablePremium() {
        const elem = document.querySelector('#taxablePremium');
        if (elem) {
            return elem.textContent.trim();
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
                let formIndex = availableForms.findIndex(f => {
                    // Exact URL ID match
                    if (f.urlId === urlId) return true;

                    // For temp_ IDs (BeginProcessing URLs), match by submission and policy number
                    if (f.urlId.startsWith('temp_')) {
                        const submissionMatch = currentSubmissionNumber && f.submissionNumber &&
                            currentSubmissionNumber === f.submissionNumber;
                        const policyMatch = currentPolicyNumber && f.policyNumber &&
                            normalizePolicyNumber(currentPolicyNumber) === normalizePolicyNumber(f.policyNumber);

                        return submissionMatch || policyMatch;
                    }

                    return false;
                });

                if (formIndex !== -1) {
                    // Move from available to history
                    const form = availableForms[formIndex];

                    // Update URL ID if this was a temp ID
                    if (form.urlId.startsWith('temp_')) {
                        console.log(LOG_PREFIX, `Updating temp ID ${form.urlId} to real ID ${urlId}`);
                        form.urlId = urlId;
                        form.url = window.location.href;
                    }

                    // Update submission number if extracted
                    if (submissionNumber) {
                        form.submissionNumber = submissionNumber;
                    }

                    // Remove from available
                    availableForms.splice(formIndex, 1);

                    // Check if already in history (match by URL ID or normalized policy number)
                    const existingHistoryIndex = history.findIndex(h => {
                        if (h.urlId === urlId) return true;

                        // Also check by normalized policy number to prevent duplicates
                        if (currentPolicyNumber && h.policyNumber) {
                            return normalizePolicyNumber(currentPolicyNumber) === normalizePolicyNumber(h.policyNumber);
                        }

                        return false;
                    });

                    if (existingHistoryIndex === -1) {
                        // Extract metadata from page
                        const policyNumber = extractPolicyNumber() || form.policyNumber;
                        const primaryInsured = extractPrimaryInsured();
                        const pagePremium = extractTotalTaxablePremium();
                        const totalPremium = pagePremium || form.premium;

                        // Add to history with initial progress
                        history.push({
                            ...form,
                            policyNumber: policyNumber,
                            checkedProgress: { current: 0, total: 0, percentage: 0 },
                            reviewedProgress: null,
                            manuallyMarkedComplete: false,
                            primaryNamedInsured: primaryInsured,
                            totalTaxablePremium: totalPremium,
                            addedDate: form.addedDate || new Date().toISOString(),
                            movedToHistoryDate: new Date().toISOString(),
                            completedDate: null
                        });
                    } else {
                        // Update movedToHistoryDate if not already set
                        if (!history[existingHistoryIndex].movedToHistoryDate) {
                            history[existingHistoryIndex].movedToHistoryDate = new Date().toISOString();
                        }
                    }

                    // Save changes
                    ext.storage.local.set({
                        tracking_availableForms: availableForms,
                        tracking_history: history
                    });

                    console.log(LOG_PREFIX, "Form detected and moved to history:", urlId);
                } else {
                    // Check if form is already in history (reopening)
                    // Match by URL ID or normalized policy number
                    let existingHistoryIndex = history.findIndex(h => {
                        if (h.urlId === urlId) return true;

                        // Also check by normalized policy number
                        if (currentPolicyNumber && h.policyNumber) {
                            return normalizePolicyNumber(currentPolicyNumber) === normalizePolicyNumber(h.policyNumber);
                        }

                        return false;
                    });

                    if (existingHistoryIndex === -1) {
                        // Not in queue, not in history - add directly to history
                        const policyNumber = extractPolicyNumber();
                        const primaryInsured = extractPrimaryInsured();
                        const totalPremium = extractTotalTaxablePremium();

                        if (policyNumber) {
                            history.push({
                                urlId: urlId,
                                url: window.location.href,
                                policyNumber: policyNumber,
                                submissionNumber: submissionNumber || '',
                                premium: totalPremium || '',
                                broker: '',
                                policyType: '',
                                checkedProgress: { current: 0, total: 0, percentage: 0 },
                                reviewedProgress: null,
                                manuallyMarkedComplete: false,
                                primaryNamedInsured: primaryInsured,
                                totalTaxablePremium: totalPremium,
                                addedDate: new Date().toISOString(),
                                movedToHistoryDate: new Date().toISOString(),
                                completedDate: null
                            });
                            ext.storage.local.set({ tracking_history: history });
                            console.log(LOG_PREFIX, "New form auto-added to history:", urlId);
                        }
                    } else {
                        // Update submission number and metadata if missing
                        if (submissionNumber && !history[existingHistoryIndex].submissionNumber) {
                            history[existingHistoryIndex].submissionNumber = submissionNumber;
                        }

                        // Update metadata on reconnect
                        const policyNumber = extractPolicyNumber();
                        const primaryInsured = extractPrimaryInsured();
                        const totalPremium = extractTotalTaxablePremium();

                        if (policyNumber) history[existingHistoryIndex].policyNumber = policyNumber;
                        if (primaryInsured) history[existingHistoryIndex].primaryNamedInsured = primaryInsured;
                        if (totalPremium) history[existingHistoryIndex].totalTaxablePremium = totalPremium;

                        ext.storage.local.set({ tracking_history: history });
                        console.log(LOG_PREFIX, "Reopening tracked form:", urlId);
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
                    history[index].reviewedProgress = {
                        current: checkedCurrent,
                        total: checkedTotal,
                        percentage: percentage
                    };
                } else {
                    history[index].checkedProgress = {
                        current: checkedCurrent,
                        total: checkedTotal,
                        percentage: percentage
                    };

                    // Update completed date if reaching 100%
                    if (percentage === 100 && !history[index].completedDate) {
                        history[index].completedDate = new Date().toISOString();
                    }
                }

                ext.storage.local.set({ tracking_history: history });
                console.log(LOG_PREFIX, `Progress updated: ${checkedCurrent}/${checkedTotal} (${percentage}%) - Review: ${isReview}`);
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
            .review-confirmed-item {
                background-color: #dbeafe !important; /* Light blue background */
                border-left: 4px solid #3b82f6 !important; /* Blue border */
                padding-left: 30px !important;
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

    console.log(LOG_PREFIX, "Tracking helper loaded");
})();
