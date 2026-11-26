import {cloneElement, isValidElement, type ReactNode} from "react";

export async function renderServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(renderServerTree));
  if (!isValidElement<{children?: ReactNode}>(node)) return node;
  if (typeof node.type === "function") {
    const component = node.type as (props: {children?: ReactNode}) => ReactNode | Promise<ReactNode>;
    return renderServerTree(await component(node.props));
  }
  return cloneElement(node, undefined, await renderServerTree(node.props.children));
}
