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

                // Validate table types
                const tableValidationError = this.validateTableTypes(config.checklist);
                if (tableValidationError) {
                    return {
                        error: {
                            type: 'VALIDATION_ERROR',
                            message: tableValidationError
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

        /**
         * Validate table type configuration
         * @param {Array} checklist - The checklist items array
         * @returns {string|null} Error message or null if valid
         */
        validateTableTypes: function(checklist) {
            for (let i = 0; i < checklist.length; i++) {
                const item = checklist[i];

                if (item.type !== 'table') {
                    continue; // Only validate table types
                }

                // Required properties for table type
                if (!item.table_selector) {
                    return `Item "${item.name}" (index ${i}): table type requires "table_selector" property`;
                }

                if (!item.columns || !Array.isArray(item.columns)) {
                    return `Item "${item.name}" (index ${i}): table type requires "columns" array`;
                }

                if (item.columns.length === 0) {
                    return `Item "${item.name}" (index ${i}): table must have at least one column`;
                }

                // Validate dynamic property
                if (item.hasOwnProperty('dynamic') && typeof item.dynamic !== 'boolean') {
                    return `Item "${item.name}" (index ${i}): "dynamic" property must be a boolean`;
                }

                // Validate row_selector
                if (!item.row_selector) {
                    return `Item "${item.name}" (index ${i}): table type requires "row_selector" property`;
                }

                // Validate columns
                const validColumnTypes = ['text', 'checkbox', 'select', 'label', 'kendo_widget'];
                for (let j = 0; j < item.columns.length; j++) {
                    const col = item.columns[j];

                    if (!col.name) {
                        return `Item "${item.name}" (index ${i}), column ${j}: missing required "name" property`;
                    }

                    if (!col.selector) {
                        return `Item "${item.name}" (index ${i}), column "${col.name}": missing required "selector" property`;
                    }

                    if (!col.type) {
                        return `Item "${item.name}" (index ${i}), column "${col.name}": missing required "type" property`;
                    }

                    if (!validColumnTypes.includes(col.type)) {
                        return `Item "${item.name}" (index ${i}), column "${col.name}": invalid type "${col.type}". Valid types: ${validColumnTypes.join(', ')}`;
                    }

                    // Validate label type specific properties
                    if (col.type === 'label' && !col.extract) {
                        return `Item "${item.name}" (index ${i}), column "${col.name}": label type requires "extract" property (e.g., "text", "innerHTML")`;
                    }
                }

                // Validate row_identifier if present
                if (item.row_identifier) {
                    if (typeof item.row_identifier.column_index !== 'number') {
                        return `Item "${item.name}" (index ${i}): row_identifier.column_index must be a number`;
                    }
                    if (item.row_identifier.column_index >= item.columns.length) {
                        return `Item "${item.name}" (index ${i}): row_identifier.column_index (${item.row_identifier.column_index}) exceeds number of columns`;
                    }
                }

                // Validate new_row_trigger if present
                if (item.new_row_trigger) {
                    if (!Array.isArray(item.new_row_trigger.columns)) {
                        return `Item "${item.name}" (index ${i}): new_row_trigger.columns must be an array`;
                    }
                    for (const colIdx of item.new_row_trigger.columns) {
                        if (typeof colIdx !== 'number' || colIdx >= item.columns.length) {
                            return `Item "${item.name}" (index ${i}): new_row_trigger contains invalid column index ${colIdx}`;
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
