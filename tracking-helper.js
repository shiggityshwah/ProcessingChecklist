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
        submissionNumber: null
    };

    /**
     * Extract URL ID from current page URL
     */
    function extractUrlId() {
        const url = window.location.href;
        const match = url.match(/\/Edit\/(\d+)\?policyId=(\d+)/);
        if (match) {
            const transactionId = match[1];
            const policyId = match[2];
            return `${transactionId}_${policyId}`;
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

                // Find in available forms
                const formIndex = availableForms.findIndex(f => f.urlId === urlId);

                if (formIndex !== -1) {
                    // Move from available to history
                    const form = availableForms[formIndex];

                    // Update submission number if extracted
                    if (submissionNumber) {
                        form.submissionNumber = submissionNumber;
                    }

                    // Remove from available
                    availableForms.splice(formIndex, 1);

                    // Check if already in history
                    const existingHistoryIndex = history.findIndex(h => h.urlId === urlId);

                    if (existingHistoryIndex === -1) {
                        // Add to history with initial progress
                        history.push({
                            ...form,
                            checkedProgress: { current: 0, total: 0, percentage: 0 },
                            reviewedProgress: null,
                            manuallyMarkedComplete: false,
                            primaryNamedInsured: null,
                            totalTaxablePremium: null,
                            addedDate: form.addedDate || new Date().toISOString(),
                            completedDate: null
                        });
                    }

                    // Save changes
                    ext.storage.local.set({
                        tracking_availableForms: availableForms,
                        tracking_history: history
                    });

                    console.log(LOG_PREFIX, "Form detected and moved to history:", urlId);
                } else {
                    // Check if form is already in history (reopening)
                    const existingHistoryIndex = history.findIndex(h => h.urlId === urlId);

                    if (existingHistoryIndex !== -1) {
                        // Update submission number if missing
                        if (submissionNumber && !history[existingHistoryIndex].submissionNumber) {
                            history[existingHistoryIndex].submissionNumber = submissionNumber;
                            ext.storage.local.set({ tracking_history: history });
                        }
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
