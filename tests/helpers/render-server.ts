import {cloneElement, isValidElement, type ReactNode} from "react";

type Props = Record<string, unknown> & {children?: ReactNode};

async function renderProps(props: Props) {
  const rendered: Props = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || isValidElement(value) || Array.isArray(value)) rendered[key] = await renderServerTree(value as ReactNode);
  }
  return rendered;
}

/**
 * Resolves the async (server) components in a tree, including those passed in props such as a screen's
 * `actions`, so the rest can be rendered to markup; client components are left for the renderer.
 */
export async function renderServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(renderServerTree));
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") {
    const component = node.type as (props: Props) => Promise<ReactNode>;
    return renderServerTree(await component(node.props));
  }
  const {children, ...props} = await renderProps(node.props);
  // static children stay arguments, so they need no keys
  if (!("children" in node.props)) return cloneElement(node, props);
  return Array.isArray(children) ? cloneElement(node, props, ...children) : cloneElement(node, props, children);
}
