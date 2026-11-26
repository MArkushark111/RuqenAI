package ai.ruqenai.mobile;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.View;
import android.widget.TextView;

final class BrandViews {
    private BrandViews() {}

    static final class Logo extends View {
        private static final String[] MARK = {
            "######  ##    ##  ######  ####### ###    ##  #####  ##",
            "##   ## ##    ## ##    ## ##      ####   ## ##   ## ##",
            "######  ##    ## ##    ## #####   ## ##  ## ####### ##",
            "##   ## ##    ## ## == ## ##      ##  ## ## ##   ## ##",
            "##   ##  ######   ######  ####### ##   #### ##   ## ##",
            "                     ~~"
        };
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Logo(Context context) {
            super(context);
            setContentDescription("Ruqenai");
        }
        @Override protected void onDraw(Canvas canvas) {
            float width = getWidth(), height = getHeight();
            if (width == 0 || height == 0) return;
            float cell = Math.min(width * 0.87f / 53, height / 13f);
            float left = (width - 53 * cell) / 2f, top = (height - 6 * cell) / 2f;
            boolean motion = ValueAnimator.areAnimatorsEnabled();
            float sweep = ((SystemClock.uptimeMillis() % 7500L) / 1700f) * (width + 100) - 50;
            paint.setShader(new LinearGradient(sweep-55, 0, sweep+55, 0,
                new int[]{0xFFD2A886, 0xFFFFECD6, 0xFFD2A886}, null, Shader.TileMode.CLAMP));
            if (!motion) { paint.setShader(null); paint.setColor(0xFFE6BB93); }
            for (int y=0; y<MARK.length; y++) {
                for (int x=0; x<MARK[y].length(); x++) {
                    char c = MARK[y].charAt(x);
                    if (c == ' ') continue;
                    float a = left + x * cell, b = top + y * cell;
                    canvas.drawRect(a, b + (c == '=' ? cell/2 : 0), a+cell+0.15f, b+(c == '~' ? cell/2 : cell), paint);
                }
            }
            paint.setShader(null);
            if (motion && isShown()) postInvalidateDelayed(42);
        }
    }

    static final class Shimmer extends TextView {
        Shimmer(Context context) { super(context); }
        @Override protected void onDraw(Canvas canvas) {
            boolean moving = ValueAnimator.areAnimatorsEnabled() && isShown();
            if (moving) {
                float textWidth = getPaint().measureText(getText().toString());
                float x = (SystemClock.uptimeMillis() % 1750L) / 1750f * (textWidth + 100f) - 50f;
                getPaint().setShader(new LinearGradient(x - 45f, 0, x + 45f, 0,
                    new int[]{0xFFA88972, 0xFFFFE4C9, 0xFFA88972}, null, Shader.TileMode.CLAMP));
            }
            super.onDraw(canvas);
            getPaint().setShader(null);
            if (moving) postInvalidateOnAnimation();
        }
    }
}
