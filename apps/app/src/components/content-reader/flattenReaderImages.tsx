import React from "react";
import { ArticleImageLightbox } from "~/components/feed/read/ArticleImageLightbox";

type ElementWithChildren = React.ReactElement<{
  children?: React.ReactNode;
}>;

type AnchorSegmentKind = "image" | "linked";

interface AnchorSegment {
  kind: AnchorSegmentKind;
  nodes: React.ReactNode[];
}

function isImageLightbox(node: React.ReactNode): boolean {
  return React.isValidElement(node) && node.type === ArticleImageLightbox;
}

function hasLinkedContent(node: React.ReactNode): boolean {
  if (typeof node === "string") return node.trim().length > 0;
  if (typeof node === "number") return true;
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return false;

  return React.Children.toArray(node.props.children).some(hasLinkedContent);
}

function mergeAdjacentSegments(segments: AnchorSegment[]): AnchorSegment[] {
  const mergedSegments: AnchorSegment[] = [];

  for (const segment of segments) {
    const previousSegment = mergedSegments.at(-1);
    if (previousSegment?.kind === segment.kind) {
      previousSegment.nodes.push(...segment.nodes);
    } else {
      mergedSegments.push({ kind: segment.kind, nodes: [...segment.nodes] });
    }
  }

  return mergedSegments;
}

function containsImage(segments: AnchorSegment[]): boolean {
  return segments.some(({ kind }) => kind === "image");
}

function createSegmentKey(
  element: ElementWithChildren,
  segmentIndex: number,
): string {
  return `${String(element.key ?? "reader")}-segment-${segmentIndex}`;
}

function splitAnchorNode(node: React.ReactNode): AnchorSegment[] {
  if (isImageLightbox(node)) {
    return [{ kind: "image", nodes: [node] }];
  }

  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return [{ kind: "linked", nodes: [node] }];
  }

  const element = node as ElementWithChildren;
  const children = React.Children.toArray(element.props.children);
  if (children.length === 0) {
    return [{ kind: "linked", nodes: [node] }];
  }

  const childSegments = mergeAdjacentSegments(
    children.flatMap(splitAnchorNode),
  );
  if (!containsImage(childSegments)) {
    return [{ kind: "linked", nodes: [node] }];
  }

  return childSegments.map((segment, segmentIndex) => ({
    kind: segment.kind,
    nodes: [
      React.cloneElement(
        element,
        { key: createSegmentKey(element, segmentIndex) },
        ...segment.nodes,
      ),
    ],
  }));
}

function transformAnchor(
  element: ElementWithChildren,
): React.ReactNode[] | null {
  const children = React.Children.toArray(element.props.children);
  const segments = mergeAdjacentSegments(children.flatMap(splitAnchorNode));
  if (!containsImage(segments)) return null;

  if (!children.some(hasLinkedContent)) {
    return children;
  }

  return segments.flatMap((segment, segmentIndex) => {
    const segmentHasLinkedContent = segment.nodes.some(hasLinkedContent);
    if (segment.kind === "image" || !segmentHasLinkedContent) {
      return segment.nodes;
    }

    return [
      React.cloneElement(
        element,
        { key: createSegmentKey(element, segmentIndex) },
        ...segment.nodes,
      ),
    ];
  });
}

function transformReaderNode(node: React.ReactNode): React.ReactNode[] | null {
  if (
    isImageLightbox(node) ||
    !React.isValidElement<{ children?: React.ReactNode }>(node)
  ) {
    return null;
  }

  const element = node as ElementWithChildren;
  const children = React.Children.toArray(element.props.children);
  if (children.length === 0) return null;

  if (element.type === "a") return transformAnchor(element);

  const transformedChildren = children.map(transformReaderNode);
  if (transformedChildren.every((child) => child === null)) return null;

  return [
    React.cloneElement(
      element,
      undefined,
      ...transformedChildren.flatMap(
        (transformedChild, childIndex) =>
          transformedChild ?? [children[childIndex]],
      ),
    ),
  ];
}

export function flattenReaderImages(
  nodes: React.ReactNode[],
): React.ReactNode[] {
  return nodes.flatMap((node) => transformReaderNode(node) ?? [node]);
}
