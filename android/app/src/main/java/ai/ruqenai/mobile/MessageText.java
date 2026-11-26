package ai.ruqenai.mobile;

import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.*;
import java.util.regex.*;

/** Lightweight native Markdown for streamed replies, including incomplete fences. */
final class MessageText {
    static CharSequence render(String input, int highlight, int codeBackground) {
        SpannableStringBuilder out = new SpannableStringBuilder();
        String[] lines = (input == null ? "" : input).split("\n", -1);
        boolean code = false;
        for (int i=0;i<lines.length;i++) {
            String line=lines[i];
            if(line.trim().startsWith("```")) { code=!code; continue; }
            int start=out.length();
            if(code) {
                out.append(line);
                span(out,new TypefaceSpan("monospace"),start,out.length());
                span(out,new BackgroundColorSpan(codeBackground),start,out.length());
            } else {
                Matcher heading=Pattern.compile("^#{1,6}\\s+(.+)$").matcher(line);
                boolean title=heading.matches(); if(title)line=heading.group(1);
                if(line.startsWith("- ")||line.startsWith("* "))line="• "+line.substring(2);
                Matcher token=Pattern.compile("\\*\\*(.+?)\\*\\*|`([^`]+)`|==(.+?)==|\\[highlight\\](.*?)\\[/highlight\\]").matcher(line);
                int cursor=0;
                while(token.find()) {
                    out.append(line.substring(cursor,token.start()));int a=out.length();
                    String value=token.group(1)!=null?token.group(1):token.group(2)!=null?token.group(2):token.group(3)!=null?token.group(3):token.group(4);
                    out.append(value);
                    if(token.group(1)!=null)span(out,new StyleSpan(Typeface.BOLD),a,out.length());
                    else if(token.group(2)!=null){span(out,new TypefaceSpan("monospace"),a,out.length());span(out,new BackgroundColorSpan(codeBackground),a,out.length());}
                    else span(out,new ForegroundColorSpan(highlight),a,out.length());
                    cursor=token.end();
                }
                out.append(line.substring(cursor));
                if(title){span(out,new StyleSpan(Typeface.BOLD),start,out.length());span(out,new RelativeSizeSpan(1.15f),start,out.length());}
            }
            if(i<lines.length-1)out.append('\n');
        }
        return out;
    }
    private static void span(SpannableStringBuilder text,Object span,int start,int end){
        if(end>start)text.setSpan(span,start,end,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }
}
