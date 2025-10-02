# Configuration Quick Reference - JSON Edition

Quick guide for common configuration tasks in ProcessingChecklist using JSON format.

## Basic Operations

### Change Form Name
```json
{
  "metadata": {
    "form_name": "Your New Form Name"
  }
}
```

### Add URL Pattern
```json
{
  "metadata": {
    "url_pattern": "index.html|production.com|app.company.com/form"
  }
}
```
Patterns are separated by `|` and matched with `includes()`.

**Also update `menu.js` line ~16:**
```javascript
const patterns = ['index.html', 'production.com', 'app.company.com/form'];
```

### Change Policy Number Field
```json
{
  "policy_number": {
    "selector": "#yourPolicyFieldId",
    "label": "Your Label"
  }
}
```

## Adding Fields

### Simple Text Field
```json
{
  "name": "Email Address",
  "type": "group",
  "fields": [
    {
      "name": "Email",
      "selector": "#emailField",
      "type": "text"
    }
  ]
}
```

### Checkbox Field
```json
{
  "name": "Agreement",
  "type": "group",
  "container_selector": "#agreeCheckbox",
  "container_levels_up": 1,
  "fields": [
    {
      "name": "I Agree to Terms",
      "selector": "#agreeCheckbox",
      "type": "checkbox"
    }
  ]
}
```

### Dropdown/Select Field
```json
{
  "name": "Country Selection",
  "type": "group",
  "fields": [
    {
      "name": "Country",
      "selector": "#countryDropdown",
      "type": "select"
    }
  ]
}
```

### Radio Buttons
```json
{
  "name": "Contact Preference",
  "type": "group",
  "fields": [
    {
      "name": "Email",
      "selector": "#contactEmail",
      "type": "radio"
    },
    {
      "name": "Phone",
      "selector": "#contactPhone",
      "type": "radio"
    }
  ]
}
```

### Multiple Fields (Address Example)
```json
{
  "name": "Shipping Address",
  "type": "group",
  "container_selector": "#shippingAddress1",
  "container_levels_up": 3,
  "fields": [
    {
      "name": "Address Line 1",
      "selector": "#shippingAddress1",
      "type": "text"
    },
    {
      "name": "Address Line 2",
      "selector": "#shippingAddress2",
      "type": "text"
    },
    {
      "name": "City",
      "selector": "#shippingCity",
      "type": "text"
    },
    {
      "name": "State",
      "selector": "#shippingState",
      "type": "select"
    },
    {
      "name": "ZIP",
      "selector": "#shippingZip",
      "type": "text"
    }
  ]
}
```

### Virtual Button/Link
```json
{
  "name": "Submit Form",
  "type": "virtual",
  "selector": "#submitButton"
}
```

### Custom Table
```json
{
  "name": "Items Table",
  "type": "custom",
  "table_id": "itemsTable",
  "container_selector": "#itemsTable",
  "fields": []
}
```

## Field Types Reference

| Type | HTML Element | Example |
|------|-------------|---------|
| `text` | `<input type="text">` | Text boxes, email, phone |
| `checkbox` | `<input type="checkbox">` | Checkboxes |
| `select` | `<select>` | Dropdown menus |
| `radio` | `<input type="radio">` | Radio buttons |
| `virtual` | Any clickable element | Buttons, links |
| `labelWithDivText` | Special label+text | "Late: Yes" patterns |

## Container Placement

Control where the confirmation checkbox appears:

```json
{
  "container_selector": "#someElement",
  "container_levels_up": 2
}
```

**Visual Guide:**
```
<div>                          ← levels_up: 3
  <div>                        ← levels_up: 2
    <div>                      ← levels_up: 1
      <input id="someElement"> ← levels_up: 0
    </div>
  </div>
</div>
```

## Finding Selectors

### Method 1: Browser Inspector
1. Right-click element → "Inspect"
2. Right-click highlighted code → "Copy" → "CSS Selector"
3. Simplify: `#myId` is better than `body > div > div > input#myId`

### Method 2: Console Testing
```javascript
// Test if selector works
document.querySelector("#yourSelector")

// Should return: <input id="yourSelector" ...>
// If null, selector is wrong
```

### Method 3: Common Patterns
```json
{
  "selector": "#fieldId"
}

{
  "selector": "[name='fieldName']"
}

{
  "selector": ".unique-class-name"
}

{
  "selector": "#formId input[name='email']"
}
```

## JSON Syntax Rules

**IMPORTANT**: JSON is strict about syntax!

✅ **Correct:**
```json
{
  "name": "Field Name",
  "type": "text",
  "selector": "#fieldId"
}
```

❌ **Wrong - Single Quotes:**
```json
{
  'name': 'Field Name'
}
```

❌ **Wrong - Trailing Comma:**
```json
{
  "name": "Field Name",
  "type": "text",
}
```

❌ **Wrong - Missing Comma:**
```json
{
  "name": "Field Name"
  "type": "text"
}
```

❌ **Wrong - Unquoted Keys:**
```json
{
  name: "Field Name"
}
```

## Common Issues & Solutions

### Issue: Checkbox in wrong place
**Solution:** Adjust `container_levels_up`
```json
{
  "container_levels_up": 1
}
```
Try 0, 1, 2, 3 until correct

### Issue: Field not found
**Solution:** Test selector in console
```javascript
document.querySelector("#yourSelector")
```

### Issue: JSON syntax error
**Solution:** Validate at https://jsonlint.com

### Issue: Kendo/custom widgets
**Solution:** Try adding `_input` suffix
```json
{
  "selector": "#autocompleteField_input"
}
```

## Validation Checklist

Before saving your config, verify:

- [ ] Valid JSON syntax (use https://jsonlint.com)
- [ ] All keys in double quotes
- [ ] All string values in double quotes
- [ ] Commas after each item (except last in array/object)
- [ ] No trailing commas
- [ ] All required fields present: `name`, `type`
- [ ] Group items have non-empty `fields` array
- [ ] Virtual items have `selector`
- [ ] Custom items have `table_id` and `container_selector`

## Testing Your Config

1. Edit `checklist-config.json`
2. Validate JSON at https://jsonlint.com
3. In Firefox: `about:debugging` → Reload extension
4. Refresh your form page
5. Check console (F12) for errors
6. Verify checkboxes appear in correct locations

## Example: Complete Item

```json
{
  "name": "Customer Information",
  "type": "group",
  "container_selector": "#customerName",
  "container_levels_up": 2,
  "fields": [
    {
      "name": "Full Name",
      "selector": "#customerName",
      "type": "text"
    },
    {
      "name": "Email",
      "selector": "#customerEmail",
      "type": "text"
    },
    {
      "name": "Subscribe to Newsletter",
      "selector": "#subscribeNewsletter",
      "type": "checkbox"
    }
  ]
}
```

## Need Help?

1. Check browser console (F12) for error messages
2. Validate JSON syntax at https://jsonlint.com
3. Review `CLAUDE.md` for detailed documentation
4. See `README.md` for troubleshooting guide
5. Examine examples in `checklist-config.json`

## Pro Tips

💡 **Use IDs when possible** - `#fieldId` is faster and more reliable

💡 **Test selectors first** - Always verify in console before adding to config

💡 **Start simple** - Add one field, test, then add more

💡 **Group related fields** - Put address fields together, contact fields together

💡 **Use descriptive names** - "Customer Email" is better than "Field 3"

💡 **Validate JSON** - Always use https://jsonlint.com before saving

💡 **Keep backup** - Save a copy before major changes

💡 **Use a JSON-aware editor** - VS Code, Notepad++, etc. will highlight syntax errors
