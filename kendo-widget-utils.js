/*************************************************************************************************
 *  kendo-widget-utils.js - Utility functions for detecting and cloning Kendo UI widgets
 *************************************************************************************************/
(function() {
    "use strict";

    const LOG_PREFIX = "[KendoWidgetUtils]";

    const KendoWidgetUtils = {
        /**
         * Detect if an element has a Kendo widget attached
         * @param {HTMLElement|jQuery} element - The element to check
         * @returns {string|null} Widget type (e.g., 'DropDownList', 'DatePicker') or null
         */
        detectWidgetType: function(element) {
            const $el = window.$ ? window.$(element) : null;
            if (!$el || !$el.length) {
                return null;
            }

            // Common Kendo widget types to check
            const widgetTypes = [
                'kendoDropDownList',
                'kendoComboBox',
                'kendoAutoComplete',
                'kendoDatePicker',
                'kendoTimePicker',
                'kendoDateTimePicker',
                'kendoNumericTextBox',
                'kendoMaskedTextBox',
                'kendoMultiSelect'
            ];

            for (const widgetType of widgetTypes) {
                const widget = $el.data(widgetType);
                if (widget) {
                    // Return the capitalized widget name (e.g., 'DropDownList')
                    return widgetType.replace('kendo', '');
                }
            }

            // Check data-role attribute as fallback
            const dataRole = $el.attr('data-role');
            if (dataRole) {
                console.log(LOG_PREFIX, `Found data-role="${dataRole}" on element`, element);
                return dataRole.charAt(0).toUpperCase() + dataRole.slice(1);
            }

            return null;
        },

        /**
         * Check if Kendo UI and jQuery are available
         * @returns {boolean}
         */
        isKendoAvailable: function() {
            return typeof window.$ !== 'undefined' && typeof window.kendo !== 'undefined';
        },

        /**
         * Extract current value from a Kendo widget
         * @param {HTMLElement|jQuery} element - The element with Kendo widget
         * @returns {any} The widget's current value
         */
        getWidgetValue: function(element) {
            const widgetType = this.detectWidgetType(element);
            if (!widgetType) {
                return null;
            }

            const $el = window.$(element);
            const widgetKey = 'kendo' + widgetType;
            const widget = $el.data(widgetKey);

            if (widget && typeof widget.value === 'function') {
                return widget.value();
            }

            // Fallback to element value
            return $el.val();
        },

        /**
         * Set value on a Kendo widget
         * @param {HTMLElement|jQuery} element - The element with Kendo widget
         * @param {any} value - The value to set
         * @returns {boolean} Success status
         */
        setWidgetValue: function(element, value) {
            const widgetType = this.detectWidgetType(element);
            if (!widgetType) {
                return false;
            }

            const $el = window.$(element);
            const widgetKey = 'kendo' + widgetType;
            const widget = $el.data(widgetKey);

            if (widget && typeof widget.value === 'function') {
                widget.value(value);
                return true;
            }

            // Fallback to element value
            $el.val(value).trigger('change');
            return true;
        },

        /**
         * Create a simple replacement input for when Kendo cloning isn't possible
         * @param {Object} field - Field configuration
         * @param {any} currentValue - Current value from original widget
         * @returns {string} HTML string for replacement input
         */
        createFallbackInput: function(field, currentValue) {
            const widgetType = this.detectWidgetType(document.querySelector(field.selector));

            if (widgetType === 'DatePicker' || widgetType === 'DateTimePicker') {
                // Use native date input
                return `<input type="date" class="fallback-date-input" data-field-selector="${field.selector}" value="${currentValue || ''}" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">`;
            } else if (widgetType === 'NumericTextBox') {
                // Use native number input
                return `<input type="number" class="fallback-numeric-input" data-field-selector="${field.selector}" value="${currentValue || ''}" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">`;
            } else {
                // Use text input with search placeholder
                return `<input type="text" class="fallback-text-input" data-field-selector="${field.selector}" value="${currentValue || ''}" placeholder="Type to search..." style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">`;
            }
        },

        /**
         * Create a read-only display with "Edit on page" button
         * @param {Object} field - Field configuration
         * @param {any} currentValue - Current value from original widget
         * @returns {string} HTML string for read-only display
         */
        createReadOnlyDisplay: function(field, currentValue) {
            const displayValue = currentValue || '(not set)';
            return `
                <div class="kendo-widget-readonly">
                    <div style="padding: 6px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px;">
                        <strong>Current value:</strong> ${displayValue}
                    </div>
                    <button class="focus-original-widget" data-selector="${field.selector}" style="width: 100%; padding: 6px 12px; background: #007cba; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Edit on page ↓
                    </button>
                </div>
            `;
        },

        /**
         * Setup event listener for "Edit on page" buttons
         * @param {HTMLElement} container - Container with buttons
         */
        setupFocusButtons: function(container) {
            const buttons = container.querySelectorAll('.focus-original-widget');
            buttons.forEach(button => {
                button.addEventListener('click', () => {
                    const selector = button.getAttribute('data-selector');
                    const originalElement = document.querySelector(selector);
                    if (originalElement) {
                        originalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        originalElement.focus();

                        // Add temporary highlight
                        originalElement.style.transition = 'background-color 0.3s';
                        originalElement.style.backgroundColor = '#ffffcc';
                        setTimeout(() => {
                            originalElement.style.backgroundColor = '';
                        }, 2000);
                    }
                });
            });
        },

        /**
         * Setup bidirectional sync between fallback input and original widget
         * @param {HTMLElement} inputElement - The fallback input element
         * @param {string} selector - Selector for original widget
         */
        setupFallbackSync: function(inputElement, selector) {
            if (!inputElement) return;

            const originalElement = document.querySelector(selector);
            if (!originalElement) return;

            // Sync from input to original
            inputElement.addEventListener('change', () => {
                this.setWidgetValue(originalElement, inputElement.value);
            });

            inputElement.addEventListener('input', () => {
                this.setWidgetValue(originalElement, inputElement.value);
            });

            // Sync from original to input
            const syncInterval = setInterval(() => {
                const originalValue = this.getWidgetValue(originalElement);
                if (originalValue !== inputElement.value) {
                    inputElement.value = originalValue || '';
                }
            }, 500);

            // Store interval ID for cleanup
            inputElement.dataset.syncInterval = syncInterval;
        },

        /**
         * Cleanup sync intervals when removing widgets
         * @param {HTMLElement} container - Container with widgets to cleanup
         */
        cleanupSync: function(container) {
            const inputs = container.querySelectorAll('[data-sync-interval]');
            inputs.forEach(input => {
                const intervalId = input.dataset.syncInterval;
                if (intervalId) {
                    clearInterval(parseInt(intervalId));
                }
            });
        }
    };

    window.KendoWidgetUtils = KendoWidgetUtils;
})();
