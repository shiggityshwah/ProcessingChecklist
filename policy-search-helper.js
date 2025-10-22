/**
 * policy-search-helper.js
 * Auto-fills policy search form with parameters from the transaction details page
 */

(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    const LOG_PREFIX = "[ProcessingChecklist-PolicySearch]";

    console.log(LOG_PREFIX, "Policy search helper loaded on URL:", window.location.href);
    console.log(LOG_PREFIX, "jQuery available:", typeof window.jQuery !== 'undefined');
    console.log(LOG_PREFIX, "Kendo available:", typeof window.kendo !== 'undefined');

    // Wait for page to be fully loaded and jQuery/Kendo to be available
    let waitAttempts = 0;
    const MAX_WAIT_ATTEMPTS = 100; // 10 seconds max

    function waitForKendo(callback) {
        waitAttempts++;

        // Check multiple jQuery locations
        const $ = window.jQuery || window.$ || (window.frames && window.frames.jQuery);
        const kendo = window.kendo;

        if ($ && kendo) {
            console.log(LOG_PREFIX, "jQuery and Kendo are now available, proceeding with callback");
            window.jQuery = $; // Ensure it's accessible
            callback();
        } else if (waitAttempts >= MAX_WAIT_ATTEMPTS) {
            console.error(LOG_PREFIX, "Timeout waiting for jQuery/Kendo after 10 seconds");
            console.log(LOG_PREFIX, "Attempting to proceed without Kendo widgets...");
            // Still try to check storage and show notification
            autoFillSearchForm();
        } else {
            if (waitAttempts % 10 === 0) {
                console.log(LOG_PREFIX, `Still waiting for jQuery/Kendo... Attempt ${waitAttempts}/${MAX_WAIT_ATTEMPTS}. jQuery:`, typeof $, "Kendo:", typeof kendo);
            }
            setTimeout(() => waitForKendo(callback), 100);
        }
    }

    /**
     * Fill Kendo ComboBox with value
     */
    function fillKendoComboBox(selector, value, isText = false) {
        const element = window.jQuery(selector);
        if (element.length === 0) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return false;
        }

        const widget = element.data('kendoComboBox');
        if (!widget) {
            console.warn(LOG_PREFIX, `Kendo ComboBox widget not found for: ${selector}`);
            return false;
        }

        try {
            if (isText) {
                // For text input (like insurer name), just set the text
                widget.text(value);
                widget.trigger('change');
            } else {
                // For ID value, set the value
                widget.value(value);
                widget.trigger('change');
            }
            console.log(LOG_PREFIX, `Filled ${selector} with:`, value);
            return true;
        } catch (error) {
            console.error(LOG_PREFIX, `Error filling ${selector}:`, error);
            return false;
        }
    }

    /**
     * Fill Kendo DatePicker with date
     */
    function fillKendoDatePicker(selector, dateString) {
        const element = window.jQuery(selector);
        if (element.length === 0) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return false;
        }

        const widget = element.data('kendoDatePicker');
        if (!widget) {
            console.warn(LOG_PREFIX, `Kendo DatePicker widget not found for: ${selector}`);
            return false;
        }

        try {
            // Parse MM/DD/YYYY format
            const parts = dateString.split('/');
            const date = new Date(parts[2], parts[0] - 1, parts[1]);

            widget.value(date);
            widget.trigger('change');
            console.log(LOG_PREFIX, `Filled ${selector} with:`, dateString);
            return true;
        } catch (error) {
            console.error(LOG_PREFIX, `Error filling ${selector}:`, error);
            return false;
        }
    }

    /**
     * Auto-fill search form with pending parameters
     */
    function autoFillSearchForm() {
        console.log(LOG_PREFIX, "autoFillSearchForm called, checking storage...");
        ext.storage.local.get('pendingPolicySearch', (result) => {
            console.log(LOG_PREFIX, "Storage result:", result);

            if (!result.pendingPolicySearch) {
                console.log(LOG_PREFIX, "No pending search parameters found in storage");
                return;
            }

            const params = result.pendingPolicySearch;
            console.log(LOG_PREFIX, "Found params:", params);

            // Check if parameters are recent (within last 5 minutes)
            const age = Date.now() - params.timestamp;
            console.log(LOG_PREFIX, "Parameter age (ms):", age, "Max allowed:", 5 * 60 * 1000);

            if (age > 5 * 60 * 1000) {
                console.log(LOG_PREFIX, "Pending search parameters are too old, ignoring");
                ext.storage.local.remove('pendingPolicySearch');
                return;
            }

            console.log(LOG_PREFIX, "Parameters are recent, showing confirmation dialog");

            // Show confirmation notification
            showAutoFillConfirmation(params);
        });
    }

    /**
     * Show confirmation notification for auto-fill
     */
    function showAutoFillConfirmation(params) {
        const notification = document.createElement('div');
        notification.id = 'auto-fill-confirmation';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: #5cb85c;
            color: white;
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 400px;
        `;

        // Check if we have jQuery/Kendo for auto-fill
        const hasKendo = typeof window.jQuery !== 'undefined' && typeof window.kendo !== 'undefined';

        let html = '<div style="font-weight: bold; margin-bottom: 8px;">🔍 Search Parameters Ready!</div>';
        if (params.brokerId) html += `<div style="margin-bottom: 3px;">Broker ID: <strong>${params.brokerId}</strong></div>`;
        if (params.insurerName) html += `<div style="margin-bottom: 3px;">Insurer: <strong>${params.insurerName}</strong></div>`;
        html += `<div style="margin-bottom: 8px;">Date Range: <strong>${params.dateFrom} to ${params.dateTo}</strong></div>`;

        if (hasKendo) {
            // Show auto-fill option
            html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; gap: 8px;">';
            html += '<button id="autoFillYesBtn" style="flex: 1; background: white; color: #5cb85c; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Fill Form</button>';
            html += '<button id="autoFillNoBtn" style="flex: 1; background: rgba(255,255,255,0.2); color: white; border: 1px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Dismiss</button>';
            html += '</div>';
        } else {
            // Show manual instructions
            html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 13px;">';
            html += '📋 <strong>Manual Fill Instructions:</strong><br>';
            html += 'Enter the values above into the search form fields.';
            html += '</div>';
            html += '<button id="dismissBtn" style="margin-top: 10px; width: 100%; background: white; color: #5cb85c; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Got It</button>';
        }

        notification.innerHTML = html;
        document.body.appendChild(notification);

        if (hasKendo) {
            // Yes button - perform auto-fill
            const yesBtn = document.getElementById('autoFillYesBtn');
            if (yesBtn) {
                yesBtn.addEventListener('click', () => {
                    notification.remove();
                    performAutoFill(params);
                });
            }

            // No button - dismiss
            const noBtn = document.getElementById('autoFillNoBtn');
            if (noBtn) {
                noBtn.addEventListener('click', () => {
                    notification.remove();
                    ext.storage.local.remove('pendingPolicySearch');
                });
            }
        } else {
            // Dismiss button
            const dismissBtn = document.getElementById('dismissBtn');
            if (dismissBtn) {
                dismissBtn.addEventListener('click', () => {
                    notification.remove();
                    ext.storage.local.remove('pendingPolicySearch');
                });
            }
        }

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
                ext.storage.local.remove('pendingPolicySearch');
            }
        }, 30000);
    }

    /**
     * Perform the actual auto-fill
     */
    function performAutoFill(params) {
        console.log(LOG_PREFIX, "Performing auto-fill with params:", params);

        let successCount = 0;

        // Fill Broker ID
        if (params.brokerId) {
            if (fillKendoComboBox('#Broker', params.brokerId, false)) {
                successCount++;
            }
        }

        // Fill Insurer Name (use text mode)
        if (params.insurerName) {
            if (fillKendoComboBox('#Insurer_input', params.insurerName, true)) {
                successCount++;
            }
        }

        // Fill Date Range
        if (params.dateFrom) {
            if (fillKendoDatePicker('#SLASubmissionDateFrom', params.dateFrom)) {
                successCount++;
            }
        }

        if (params.dateTo) {
            if (fillKendoDatePicker('#SLASubmissionDateTo', params.dateTo)) {
                successCount++;
            }
        }

        // Show success notification
        showSuccessNotification(successCount);

        // Clear pending search
        ext.storage.local.remove('pendingPolicySearch');
    }

    /**
     * Show success notification after auto-fill
     */
    function showSuccessNotification(count) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: #5cb85c;
            color: white;
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 350px;
        `;
        notification.innerHTML = `<div style="font-weight: bold;">✓ Auto-filled ${count} field${count !== 1 ? 's' : ''}!</div><div style="margin-top: 4px; font-size: 12px; opacity: 0.9;">You can now click Search to find similar policies</div>`;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    // Initialize when Kendo is ready
    console.log(LOG_PREFIX, "Starting waitForKendo...");
    waitForKendo(() => {
        console.log(LOG_PREFIX, "jQuery and Kendo are available, checking for pending search");

        // Wait a bit more for form to be fully initialized
        setTimeout(() => {
            console.log(LOG_PREFIX, "Calling autoFillSearchForm after 1 second delay");
            autoFillSearchForm();
        }, 1000);
    });

})();
