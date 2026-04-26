/**
 * property-descriptors.js
 *
 * Data contract for structured property panels.
 *
 * Plugins return an array of PropertyGroup objects from
 * `getPanelDescriptors(selected)`. The shell renders them
 * generically into the Properties panel.
 *
 * @typedef {Object} PropertyGroup
 * @property {string} label — Group heading, e.g. "Position"
 * @property {PropertyDescriptor[]} properties
 *
 * @typedef {Object} PropertyDescriptor
 * @property {string} key — Unique key like 'x', 'y', 'fill'
 * @property {string} label — Display label
 * @property {'readonly'|'text'|'number'|'color'} type
 * @property {*} value — Current value
 * @property {Function} [onChange] — Called with (newValue). Absent for readonly.
 */

/**
 * Render a single PropertyDescriptor into a DOM element.
 * @param {PropertyDescriptor} descriptor
 * @param {import('./shell-core.js').UIHelper} ui
 * @returns {HTMLElement}
 */
export function renderProperty(descriptor, ui) {
  const row = document.createElement('div');
  row.className = 'property-row';
  row.dataset.propertyKey = descriptor.key;

  if (descriptor.type === 'readonly') {
    row.innerHTML = `
      <span class="property-label">${descriptor.label}</span>
      <span class="property-readonly">${descriptor.value ?? ''}</span>
    `;
    return row;
  }

  if (descriptor.type === 'color') {
    const label = document.createElement('span');
    label.className = 'property-label';
    label.textContent = descriptor.label;
    row.appendChild(label);

    const colorWrap = document.createElement('div');
    colorWrap.className = 'property-color-wrap';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'property-color-input';
    colorInput.value = toHexColor(descriptor.value);
    colorInput.dataset.propertyKey = descriptor.key;
    if (descriptor.onChange) {
      colorInput.addEventListener('input', (e) => descriptor.onChange(e.target.value));
    }
    colorWrap.appendChild(colorInput);

    const hexLabel = document.createElement('span');
    hexLabel.className = 'property-color-hex';
    hexLabel.textContent = colorInput.value;
    colorInput.addEventListener('input', () => {
      hexLabel.textContent = colorInput.value;
    });
    colorWrap.appendChild(hexLabel);

    row.appendChild(colorWrap);
    return row;
  }

  // text or number — use shell.ui.createInput
  if (ui) {
    const label = document.createElement('span');
    label.className = 'property-label';
    label.textContent = descriptor.label;
    row.appendChild(label);

    const input = ui.createInput({
      type: descriptor.type === 'number' ? 'number' : 'text',
      value: descriptor.value ?? '',
      layout: 'compact',
      onInput: descriptor.onChange || (() => {}),
    });
    input.dataset.propertyKey = descriptor.key;
    row.appendChild(input);
    return row;
  }

  // Fallback — plain input
  row.innerHTML = `
    <span class="property-label">${descriptor.label}</span>
    <input class="property-fallback-input" type="${descriptor.type}" value="${descriptor.value ?? ''}">
  `;
  const inp = row.querySelector('input');
  if (descriptor.onChange) {
    inp.addEventListener('input', (e) => descriptor.onChange(e.target.value));
  }
  return row;
}

/**
 * Render an array of PropertyGroups into a document fragment.
 * @param {PropertyGroup[]} groups
 * @param {object} ui — shell.ui helper
 * @returns {DocumentFragment}
 */
export function renderPropertyGroups(groups, ui) {
  const fragment = document.createDocumentFragment();

  for (const group of groups) {
    if (!group.properties || group.properties.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'property-group';

    const heading = document.createElement('h4');
    heading.className = 'property-group-heading';
    heading.textContent = group.label;
    section.appendChild(heading);

    for (const prop of group.properties) {
      section.appendChild(renderProperty(prop, ui));
    }

    fragment.appendChild(section);
  }

  return fragment;
}

/**
 * Best-effort conversion of CSS color values to hex for <input type="color">.
 */
function toHexColor(val) {
  if (!val || val === 'transparent') return '#000000';
  if (val.startsWith('#')) {
    // Normalise 3-digit hex
    if (val.length === 4) {
      return '#' + val[1]+val[1] + val[2]+val[2] + val[3]+val[3];
    }
    return val.slice(0, 7);
  }
  // rgb(r, g, b)
  const match = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (match) {
    const [, r, g, b] = match;
    return '#' + [r, g, b].map(c => parseInt(c).toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}
