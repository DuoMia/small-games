import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  color: string;
  size: number;
  isEraser: boolean;
  points: Point[];
}

export interface DrawingCanvasHandle {
  undo: () => void;
  clear: () => void;
  toDataURL: () => string;
  isEmpty: () => boolean;
  getStrokes: () => Stroke[];
}

interface DrawingCanvasProps {
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  color: string;
  brushSize: number;
  tool: "pen" | "eraser";
  // 合作画画专用：禁用绘制（对方回合时）
  disabled?: boolean;
  // 合作画画专用：笔画事件回调（用于实时同步）
  onStrokeStart?: (stroke: Stroke) => void;
  onStrokePoint?: (point: Point) => void;
  onStrokeEnd?: () => void;
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 450;

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  ({ strokes, onStrokesChange, color, brushSize, tool, disabled, onStrokeStart, onStrokePoint, onStrokeEnd }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const drawingRef = useRef(false);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const strokesRef = useRef<Stroke[]>(strokes);

    // 同步外部 strokes 到 ref
    useEffect(() => {
      strokesRef.current = strokes;
      redraw();
    }, [strokes]);

    // 初始化 canvas
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctxRef.current = ctx;
      redraw();
    }, []);

    const redraw = useCallback(() => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      strokesRef.current.forEach((stroke) => drawStroke(ctx, stroke));
    }, []);

    const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      if (stroke.points.length === 0) return;
      ctx.save();
      ctx.globalCompositeOperation = stroke.isEraser
        ? "destination-out"
        : "source-over";
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      const first = stroke.points[0];
      ctx.moveTo(first.x, first.y);
      if (stroke.points.length === 1) {
        // 单点：画一个圆点
        ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
      } else {
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    const getCanvasPoint = (e: React.PointerEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      const point = getCanvasPoint(e);
      currentStrokeRef.current = {
        color: tool === "eraser" ? "#FFFFFF" : color,
        size: tool === "eraser" ? brushSize * 3 : brushSize,
        isEraser: tool === "eraser",
        points: [point],
      };
      // 画起始点
      const ctx = ctxRef.current;
      if (ctx && currentStrokeRef.current) {
        drawStroke(ctx, currentStrokeRef.current);
      }
      // 合作画画：通知开始一笔
      onStrokeStart?.(currentStrokeRef.current);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (!drawingRef.current || !currentStrokeRef.current) return;
      e.preventDefault();
      const point = getCanvasPoint(e);
      currentStrokeRef.current.points.push(point);
      // 增量绘制最后一段
      const ctx = ctxRef.current;
      if (!ctx) return;
      const pts = currentStrokeRef.current.points;
      if (pts.length >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = currentStrokeRef.current.isEraser
          ? "destination-out"
          : "source-over";
        ctx.strokeStyle = currentStrokeRef.current.color;
        ctx.lineWidth = currentStrokeRef.current.size;
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        ctx.restore();
      }
      // 合作画画：通知笔画进行中的点
      onStrokePoint?.(point);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      drawingRef.current = false;
      if (currentStrokeRef.current && currentStrokeRef.current.points.length > 0) {
        const newStrokes = [...strokesRef.current, currentStrokeRef.current];
        strokesRef.current = newStrokes;
        onStrokesChange(newStrokes);
      }
      currentStrokeRef.current = null;
      // 合作画画：通知一笔结束
      onStrokeEnd?.();
    };

    // 暴露方法
    useImperativeHandle(ref, () => ({
      undo: () => {
        const newStrokes = strokesRef.current.slice(0, -1);
        strokesRef.current = newStrokes;
        onStrokesChange(newStrokes);
        redraw();
      },
      clear: () => {
        strokesRef.current = [];
        onStrokesChange([]);
        redraw();
      },
      toDataURL: () => {
        const canvas = canvasRef.current;
        if (!canvas) return "";
        return canvas.toDataURL("image/jpeg", 0.7);
      },
      isEmpty: () => strokesRef.current.length === 0,
      getStrokes: () => strokesRef.current,
    }));

    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none bg-white rounded-doodle"
        style={{ aspectRatio: "4 / 3" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    );
  }
);

DrawingCanvas.displayName = "DrawingCanvas";
