package ai.ruqenai.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;
import android.widget.TextView;

/** Small native drawing primitives: no timers survive detached views. */
final class MotionViews {
    static final class Shimmer extends TextView {
        private final int base, shine;
        private final LinearGradient sweep;
        private final Matrix matrix = new Matrix();
        Shimmer(Context context, int base, int shine) {
            super(context); this.base = base; this.shine = shine; setTextColor(base);
            sweep = new LinearGradient(-65,0,65,0,new int[]{base,shine,base},null,Shader.TileMode.CLAMP);
        }
        @Override protected void onDraw(Canvas canvas) {
            boolean moving = ValueAnimator.areAnimatorsEnabled() && isShown() && hasWindowFocus();
            if (moving) {
                float width = Math.max(120, getPaint().measureText(getText().toString()));
                float x = (SystemClock.uptimeMillis() % 1800L) / 1800f * (width + 160) - 80;
                matrix.setTranslate(x,0); sweep.setLocalMatrix(matrix); getPaint().setShader(sweep);
            }
            super.onDraw(canvas); getPaint().setShader(null);
            if (moving) postInvalidateDelayed(32);
        }
    }

    /** One 24-unit stroke family for navigation and composer controls. */
    static final class Icon extends Drawable {
        final String name; final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Path path = new Path();
        Icon(String name, int color) { this.name = name; paint.setColor(color); }
        @Override public void draw(Canvas c) {
            c.save(); c.translate(getBounds().left, getBounds().top);
            c.scale(getBounds().width()/24f, getBounds().height()/24f);
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(1.65f);
            paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
            Path p = path; p.reset();
            switch(name) {
                case "menu": c.drawRoundRect(3,4,21,20,3,3,paint); c.drawLine(9,4,9,20,paint); break;
                case "edit": p.moveTo(14,4); p.lineTo(20,10); p.moveTo(4,20); p.lineTo(5,14); p.lineTo(16,3); p.lineTo(21,8); p.lineTo(10,19); p.close(); c.drawPath(p,paint); break;
                case "plus": c.drawLine(12,5,12,19,paint); c.drawLine(5,12,19,12,paint); break;
                case "send": p.moveTo(6,11); p.lineTo(12,5); p.lineTo(18,11); p.moveTo(12,5); p.lineTo(12,20); c.drawPath(p,paint); break;
                case "stop": paint.setStyle(Paint.Style.FILL); c.drawRoundRect(6,6,18,18,2,2,paint); break;
                case "chevron": p.moveTo(8,10); p.lineTo(12,14); p.lineTo(16,10); c.drawPath(p,paint); break;
                case "check": p.moveTo(5,12); p.lineTo(10,17); p.lineTo(20,7); c.drawPath(p,paint); break;
                case "close": c.drawLine(6,6,18,18,paint); c.drawLine(18,6,6,18,paint); break;
                case "chat": c.drawRoundRect(3,4,21,18,3,3,paint); p.moveTo(7,18); p.lineTo(7,22); p.lineTo(12,18); c.drawPath(p,paint); break;
                case "code": p.moveTo(8,6); p.lineTo(2,12); p.lineTo(8,18); p.moveTo(16,6); p.lineTo(22,12); p.lineTo(16,18); p.moveTo(14,4); p.lineTo(10,20); c.drawPath(p,paint); break;
                case "file": p.moveTo(5,3); p.lineTo(14,3); p.lineTo(20,9); p.lineTo(20,21); p.lineTo(5,21); p.close(); p.moveTo(14,3); p.lineTo(14,9); p.lineTo(20,9); c.drawPath(p,paint); break;
                default: c.drawCircle(12,12,8,paint); c.drawCircle(12,12,3,paint);
            }
            c.restore();
        }
        @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
        @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }
}
