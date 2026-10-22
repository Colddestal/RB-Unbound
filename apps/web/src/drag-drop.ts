export type ClientPoint = { x: number; y: number };

export type ClientRectLike = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function pointInRect(point: ClientPoint, rect: ClientRectLike): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function localHandDropRect(board: ClientRectLike): ClientRectLike {
  const height = board.bottom - board.top;
  const handHeight = Math.max(115, Math.min(150, height * 0.22));
  return {
    left: board.left,
    right: board.right,
    top: board.bottom - handHeight,
    bottom: board.bottom,
  };
}
