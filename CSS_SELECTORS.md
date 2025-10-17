# CSS Selector Reference

This document lists all the unique IDs and classes that can be used to target specific elements in `style.css`.

## Validation Containers

Each validation container (warning icon + auto-fix button) has a unique ID based on its field selector.

### ID Format
- **Pattern:** `alphabetize-validation-{fieldId}`
- **Example:** For `#PolicyNumber`, the ID is `alphabetize-validation-PolicyNumber`
- **Example:** For `#PrimaryInsuredName`, the ID is `alphabetize-validation-PrimaryInsuredName`

### Data Attributes
- `data-field-selector`: Original CSS selector (e.g., `#PolicyNumber`)
- `data-field-type`: Type of validation (`policyNumber` or `namedInsured`)

### CSS Targeting Examples

```css
/* Target the PolicyNumber validation container */
#alphabetize-validation-PolicyNumber {
    right: 10px; /* Move it further right */
}

/* Target the Secondary Insured validation container */
#alphabetize-validation-SecondaryInsuredName {
    right: 50px;
    top: 60%; /* Adjust vertical position */
}

/* Target all validation containers for namedInsured type */
.alphabetize-validation-container[data-field-type="namedInsured"] {
    background: rgba(255, 255, 0, 0.1);
}

/* Target validation container by original selector */
.alphabetize-validation-container[data-field-selector="#PolicyNumber"] {
    border: 1px solid red;
}
```

## Checkboxes (Traditional)

Traditional checkboxes (positioned via container selector) have multiple ways to target them.

### Classes
- Base class: `processing-checklist-checkbox`
- Field-specific class: `checkbox-{fieldId}`
  - Example: `checkbox-PolicyNumber` for `#PolicyNumber`
  - Example: `checkbox-PrimaryInsuredName` for `#PrimaryInsuredName`

### Data Attributes
- `data-field-id`: Simplified field ID (e.g., `PolicyNumber`)
- `data-field-selector`: Original CSS selector (e.g., `#PolicyNumber`)
- `data-item-index`: Numeric index in checklist array
- `data-item-name`: Human-readable item name (e.g., `"Policy Number"`)

### CSS Targeting Examples

```css
/* Target the Primary Insured checkbox */
.checkbox-PrimaryInsuredName {
    left: 10px; /* Adjust position */
    width: 20px;
    height: 20px;
}

/* Target the Secondary Insured checkbox */
.checkbox-SecondaryInsuredName {
    left: 15px;
}

/* Target checkbox by item name */
.processing-checklist-checkbox[data-item-name="Policy Number"] {
    border: 2px solid blue;
}

/* Target checkbox by field selector */
.processing-checklist-checkbox[data-field-selector="#PolicyNumber"] {
    opacity: 0.9;
}
```

## Zone Checkboxes

Zone checkboxes (positioned on highlight zones) have similar targeting options.

### Classes
- Base class: `zone-checkbox`
- Field-specific class: `zone-checkbox-{fieldId}`
  - Example: `zone-checkbox-PrimaryInsuredName`

### Data Attributes
- `data-zone-checkbox`: Always `"true"` to identify as zone checkbox
- `data-field-id`: Simplified field ID
- `data-field-selector`: Original CSS selector
- `data-item-index`: Numeric index in checklist array
- `data-zone-index`: Zone index (0, 1, 2, etc. if multiple zones)
- `data-item-name`: Human-readable item name

### CSS Targeting Examples

```css
/* Target all zone checkboxes for Primary Insured */
.zone-checkbox-PrimaryInsuredName {
    width: 22px;
    height: 22px;
}

/* Target first zone checkbox for a specific field */
.zone-checkbox[data-field-selector="#PrimaryInsuredName"][data-zone-index="0"] {
    border-radius: 50%; /* Make it circular */
}

/* Target zone checkboxes by item name */
.zone-checkbox[data-item-name="Named Insured"] {
    background-color: rgba(255, 255, 255, 0.95);
}
```

## Common Field Selectors

Based on typical configuration, here are common field IDs:

| Field Selector | Generated ID | Usage |
|----------------|--------------|-------|
| `#PolicyNumber` | `PolicyNumber` | Policy number field |
| `#PrimaryInsuredName` | `PrimaryInsuredName` | Primary insured name |
| `#SecondaryInsuredName` | `SecondaryInsuredName` | Secondary insured name |
| `#MailingAddress1` | `MailingAddress1` | Mailing address line 1 |
| `#PhysicalAddress1` | `PhysicalAddress1` | Physical address line 1 |

## Selector Conversion Rules

The `selectorToId()` function converts CSS selectors to valid IDs:

1. Removes leading `#` or `.`
2. Replaces special characters (except `_` and `-`) with hyphens

### Examples

| CSS Selector | Generated ID |
|--------------|--------------|
| `#PolicyNumber` | `PolicyNumber` |
| `#Primary-Insured_Name` | `Primary-Insured_Name` |
| `.some-class` | `some-class` |
| `#field[type="text"]` | `field-type---text--` |

## Complete Targeting Example

Here's how to customize the Secondary Insured field completely:

```css
/* Move the validation container */
#alphabetize-validation-SecondaryInsuredName {
    right: 100px;
    top: 40%;
}

/* Style the traditional checkbox */
.checkbox-SecondaryInsuredName {
    left: 20px;
    width: 24px;
    height: 24px;
    border: 2px solid #667eea;
}

/* Style the zone checkbox (if using highlight zones) */
.zone-checkbox-SecondaryInsuredName {
    width: 24px;
    height: 24px;
    box-shadow: 0 0 8px rgba(102, 126, 234, 0.5);
}

/* Target by data attribute for extra specificity */
.alphabetize-validation-container[data-field-selector="#SecondaryInsuredName"] .alphabetize-fix-button {
    background: #28a745; /* Different color for this field */
}
```

## Notes

- All IDs and classes are dynamically generated based on the configuration
- If a field's selector changes in `checklist-config.json`, the generated IDs will also change
- Use data attributes for more flexible targeting that survives selector changes
- The `data-field-selector` attribute always contains the exact selector from the config
