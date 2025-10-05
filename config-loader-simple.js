/*************************************************************************************************
 *  config-loader-simple.js - Simplified configuration loader using JSON
 *************************************************************************************************/
(function() {
    "use strict";

    const ConfigLoader = {
        /**
         * Load and validate the configuration file
         * @returns {Promise<Object>} Configuration object or error object
         */
        load: async function() {
            try {
                // Check if running in extension context or standalone HTML
                let configUrl;
                const isExtensionContext = (typeof browser !== 'undefined' && browser.runtime) ||
                                          (typeof chrome !== 'undefined' && chrome.runtime);

                if (isExtensionContext) {
                    const ext = (typeof browser !== 'undefined') ? browser : chrome;
                    configUrl = ext.runtime.getURL('checklist-config.json');
                } else {
                    // Running in standalone HTML (test environment)
                    configUrl = 'checklist-config.json';
                }

                const response = await fetch(configUrl);
                if (!response.ok) {
                    return {
                        error: {
                            type: 'LOAD_ERROR',
                            message: `Failed to load configuration: ${response.statusText}`
                        }
                    };
                }

                const config = await response.json();

                // Basic validation
                if (!config.checklist || !Array.isArray(config.checklist)) {
                    return {
                        error: {
                            type: 'VALIDATION_ERROR',
                            message: 'Invalid configuration: missing checklist array'
                        }
                    };
                }

                // Validate highlight_zones if present
                const zonesValidationError = this.validateHighlightZones(config.checklist);
                if (zonesValidationError) {
                    return {
                        error: {
                            type: 'VALIDATION_ERROR',
                            message: zonesValidationError
                        }
                    };
                }

                // Validate field types
                const fieldValidationError = this.validateFieldTypes(config.checklist);
                if (fieldValidationError) {
                    return {
                        error: {
                            type: 'VALIDATION_ERROR',
                            message: fieldValidationError
                        }
                    };
                }

                return {
                    metadata: config.metadata || {},
                    policyNumber: config.policy_number || { selector: '#PolicyNumber' },
                    checklist: config.checklist,
                    raw: config
                };
            } catch (error) {
                return {
                    error: {
                        type: 'UNEXPECTED_ERROR',
                        message: error.message
                    }
                };
            }
        },

        /**
         * Validate highlight_zones schema for all checklist items
         * @param {Array} checklist - The checklist items array
         * @returns {string|null} Error message or null if valid
         */
        validateHighlightZones: function(checklist) {
            const validEdges = ['top', 'bottom', 'left', 'right'];

            for (let i = 0; i < checklist.length; i++) {
                const item = checklist[i];

                if (!item.highlight_zones) {
                    continue; // highlight_zones is optional
                }

                if (!Array.isArray(item.highlight_zones)) {
                    return `Item "${item.name}" (index ${i}): highlight_zones must be an array`;
                }

                for (let j = 0; j < item.highlight_zones.length; j++) {
                    const zone = item.highlight_zones[j];

                    // Check that all four edges are present
                    for (const edge of validEdges) {
                        if (!zone[edge]) {
                            return `Item "${item.name}" (index ${i}), zone ${j}: missing required edge "${edge}"`;
                        }

                        const edgeConfig = zone[edge];

                        // Validate edge config structure
                        if (typeof edgeConfig !== 'object') {
                            return `Item "${item.name}" (index ${i}), zone ${j}, edge "${edge}": must be an object`;
                        }

                        if (typeof edgeConfig.selector !== 'string') {
                            return `Item "${item.name}" (index ${i}), zone ${j}, edge "${edge}": selector must be a string`;
                        }

                        if (!validEdges.includes(edgeConfig.edge)) {
                            return `Item "${item.name}" (index ${i}), zone ${j}, edge "${edge}": edge property must be one of ${validEdges.join(', ')}`;
                        }

                        if (typeof edgeConfig.offset !== 'number') {
                            return `Item "${item.name}" (index ${i}), zone ${j}, edge "${edge}": offset must be a number`;
                        }
                    }

                    // Validate show_checkbox if present
                    if (zone.hasOwnProperty('show_checkbox') && typeof zone.show_checkbox !== 'boolean') {
                        return `Item "${item.name}" (index ${i}), zone ${j}: show_checkbox must be a boolean`;
                    }
                }
            }

            return null; // All valid
        },

        /**
         * Validate field types in checklist items
         * @param {Array} checklist - The checklist items array
         * @returns {string|null} Error message or null if valid
         */
        validateFieldTypes: function(checklist) {
            const validTypes = ['text', 'checkbox', 'select', 'radio', 'virtual', 'labelWithDivText', 'kendo_widget'];

            for (let i = 0; i < checklist.length; i++) {
                const item = checklist[i];

                if (!item.fields || !Array.isArray(item.fields)) {
                    continue; // Some items may not have fields (virtual, custom)
                }

                for (let j = 0; j < item.fields.length; j++) {
                    const field = item.fields[j];

                    if (!field.type) {
                        return `Item "${item.name}" (index ${i}), field ${j}: missing required "type" property`;
                    }

                    if (!validTypes.includes(field.type)) {
                        return `Item "${item.name}" (index ${i}), field "${field.name}": invalid type "${field.type}". Valid types: ${validTypes.join(', ')}`;
                    }

                    // Validate kendo_widget specific properties
                    if (field.type === 'kendo_widget') {
                        if (!field.selector) {
                            return `Item "${item.name}" (index ${i}), field "${field.name}": kendo_widget requires "selector" property`;
                        }
                    }
                }
            }

            return null; // All valid
        },

        showErrorNotification: function(errorObject) {
            const message = errorObject.error ? errorObject.error.message : 'Unknown error';
            console.error('[ProcessingChecklist Config Error]', message);
        }
    };

    window.ConfigLoader = ConfigLoader;
})();
