type Child = Node | string | null | undefined | false;

interface ElementProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

/** Tiny DOM builder: el('button', { class: 'btn', on: { click } }, ['Play']). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const [type, handler] of Object.entries(props.on ?? {})) node.addEventListener(type, handler as EventListener);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** A row of mutually exclusive buttons. */
export function segmented<T extends string | number>(
  options: Array<{ value: T; label: string }>,
  selected: T,
  onChange: (value: T) => void,
): HTMLDivElement {
  const group = el('div', { class: 'segmented', attrs: { role: 'radiogroup' } });
  const buttons = options.map((option) =>
    el('button', {
      class: 'segment',
      text: option.label,
      attrs: { type: 'button', role: 'radio', 'aria-checked': String(option.value === selected) },
      on: {
        click: () => {
          buttons.forEach((b) => b.setAttribute('aria-checked', 'false'));
          buttons[options.indexOf(option)]!.setAttribute('aria-checked', 'true');
          onChange(option.value);
        },
      },
    }),
  );
  group.append(...buttons);
  return group;
}
