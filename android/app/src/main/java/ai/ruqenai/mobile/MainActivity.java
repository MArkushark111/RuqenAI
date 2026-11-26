package ai.ruqenai.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Ruqenai mobile: standalone chat with a local API key. No PC pairing.
 */
public class MainActivity extends Activity {
    private static final String[] PROVIDERS = {"DeepSeek", "OpenAI", "OpenRouter", "Groq", "Custom compatible"};
    private static final String[] BASE_URLS = {"https://api.deepseek.com", "https://api.openai.com/v1",
        "https://openrouter.ai/api/v1", "https://api.groq.com/openai/v1", ""};
    private int provider;
    private String baseUrl;
    private boolean loadingAttachment;
    private static final String MODEL = "deepseek-chat";

    private static int BG, SURFACE, PANEL, RULE, INK, MUTED, COPPER, DARK_INK, GREEN;

    private SharedPreferences prefs;
    private boolean dark = true;
    private String apiKey = "";

    private JSONArray chats = new JSONArray();
    private JSONArray messages = new JSONArray();
    private String chatId = "";
    private String chatName = "";

    private LinearLayout messageList;
    private ScrollView scroller;
    private EditText input;
    private TextView sendButton;
    private TextView titleLabel;
    private boolean sending = false;
    private TextView streamingBubble;
    private volatile HttpURLConnection activeConnection;
    private volatile boolean stopped;
    private TextView thinkingView;
    private android.webkit.WebView sceneView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("ruqenai", Context.MODE_PRIVATE);
        dark = prefs.getBoolean("dark", true);
        provider = Math.max(0, Math.min(PROVIDERS.length - 1, prefs.getInt("provider", 0)));
        apiKey = providerKey(provider);
        baseUrl = providerBase(provider);
        loadChats();
        model = providerModel(provider);
        applyPalette();
        if (apiKey.isEmpty()) buildGate(); else buildChat();
    }

    // ---------------------------------------------------------------- palette

    private void applyPalette() {
        if (dark) {
            BG = 0xFF131211; SURFACE = 0xFF1B1A18; PANEL = 0xFF24221F;
            RULE = 0xFF3A3733; INK = 0xFFF1EDE5; MUTED = 0xFFA9A296;
            COPPER = 0xFFF1EDE5; DARK_INK = 0xFF131211; GREEN = 0xFF74C69B;
        } else {
            BG = 0xFFECEAE4; SURFACE = 0xFFF8F6F1; PANEL = 0xFFE2DFD7;
            RULE = 0xFFCCC6BA; INK = 0xFF24221F; MUTED = 0xFF696257;
            COPPER = 0xFF24221F; DARK_INK = 0xFFF8F6F1; GREEN = 0xFF2F7A52;
        }
        try {
            getWindow().setStatusBarColor(BG);
            getWindow().setNavigationBarColor(BG);
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------- gate

    private void buildGate() {
        stopAscii();
        LinearLayout root = column(); root.setBackgroundColor(BG); insetPad(root);
        LinearLayout bar = row(); bar.setGravity(Gravity.END);
        bar.addView(iconButton("theme", "Change appearance", MUTED, () -> toggleTheme()),new LinearLayout.LayoutParams(dp(48),dp(48)));
        root.addView(bar);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        LinearLayout content = column(); content.setGravity(Gravity.CENTER_VERTICAL);
        int gutter = Math.max(28, (int)(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density - 500)/2);
        content.setPadding(dp(gutter),dp(24),dp(gutter),dp(32));
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.logo_mark);
        logo.setContentDescription("Ruqenai"); content.addView(logo,new LinearLayout.LayoutParams(dp(52),dp(52)));
        gap(content,28);
        TextView title = label("A space for\nyour next idea.",34,INK);
        title.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL)); title.setLineSpacing(dp(2),1f);
        content.addView(title); gap(content,14);
        TextView detail = label("Think it through. Write the code.\nMake something that matters.",16,MUTED);
        detail.setLineSpacing(dp(4),1f); content.addView(detail); gap(content,40);
        TextView go = primary("Set up an API provider");
        go.setOnClickListener(v -> keyDialog());
        content.addView(go,new LinearLayout.LayoutParams(-1,dp(52)));
        scroll.addView(content,new ScrollView.LayoutParams(-1,-2)); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1f));
        setContentView(root); enter(content,18,400);
    }

    private String providerKey(int index) {
        return prefs.getString("provider.key." + index, index == 0 ? prefs.getString("apiKey", "") : "");
    }

    private String providerModel(int index) {
        return prefs.getString("provider.model." + index, index == 0 ? prefs.getString("model", "deepseek-chat") : "");
    }

    private String providerBase(int index) {
        return index == 4 ? prefs.getString("provider.customBase", "") : BASE_URLS[index];
    }

    private void keyDialog() {
        if (sending || loadingAttachment) { toast("Wait for the current message to finish."); return; }
        LinearLayout panel = column();
        panel.setPadding(dp(24), dp(12), dp(24), dp(16));
        android.widget.Spinner picker = new android.widget.Spinner(this);
        picker.setContentDescription("API provider");
        android.widget.ArrayAdapter<String> adapter = new android.widget.ArrayAdapter<>(this,
            android.R.layout.simple_spinner_dropdown_item, PROVIDERS);
        picker.setAdapter(adapter);
        picker.setSelection(provider);
        panel.addView(picker, new LinearLayout.LayoutParams(-1, dp(48)));
        TextView endpointLabel = label("HTTPS base URL", 13, INK);
        EditText endpoint = field("https://provider.example/v1");
        TextView modelLabel = label("Model ID", 13, INK);
        EditText modelField = field("Enter the model ID from your provider");
        EditText keyField = field("API key");
        keyField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        String[][] drafts = new String[PROVIDERS.length][];
        for (int i = 0; i < drafts.length; i++) drafts[i] = new String[]{providerBase(i), providerModel(i), ""};
        int[] selected = {-1};
        picker.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int index, long id) {
                if (selected[0] == index) return;
                if (selected[0] >= 0) drafts[selected[0]] = new String[]{endpoint.getText().toString(),
                    modelField.getText().toString(), keyField.getText().toString()};
                selected[0] = index;
                endpoint.setText(drafts[index][0]); endpoint.setEnabled(index == 4);
                modelField.setText(drafts[index][1]); keyField.setText(drafts[index][2]);
                keyField.setHint(providerKey(index).isEmpty() ? "API key" : "Saved key · leave blank to keep");
            }
        });
        panel.addView(endpointLabel); panel.addView(endpoint); gap(panel, 12);
        panel.addView(modelLabel); panel.addView(modelField); gap(panel, 12);
        panel.addView(label("API key", 13, INK)); panel.addView(keyField);
        ScrollView scroll = new ScrollView(this); scroll.addView(panel);
        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(
            new android.view.ContextThemeWrapper(this, dark ? android.R.style.Theme_Material_Dialog_Alert :
                android.R.style.Theme_Material_Light_Dialog_Alert))
            .setTitle("API provider").setView(scroll).setNegativeButton("Cancel", null)
            .setPositiveButton("Save and use", null).create();
        dialog.show();
        dialog.getButton(Dialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            int index = picker.getSelectedItemPosition();
            String chosenModel = modelField.getText().toString().trim();
            String chosenBase = endpoint.getText().toString().trim().replaceAll("/+$", "");
            String entered = keyField.getText().toString().trim();
            try {
                java.net.URI uri = java.net.URI.create(chosenBase);
                if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || chosenBase.endsWith("/chat/completions")) throw new IllegalArgumentException();
            } catch (IllegalArgumentException error) {
                endpoint.setError("Enter an HTTPS base URL without /chat/completions."); return;
            }
            if (chosenModel.isEmpty()) { modelField.setError("Enter a model ID."); return; }
            String chosenKey = entered.isEmpty() ? providerKey(index) : entered;
            if (chosenKey.isEmpty() || (index == 4 && !chosenBase.equals(baseUrl) && !chosenBase.equals(providerBase(index)) && entered.isEmpty())) {
                keyField.setError("Enter the API key for this endpoint."); return;
            }
            SharedPreferences.Editor edit = prefs.edit().putInt("provider", index)
                .putString("provider.key." + index, chosenKey).putString("provider.model." + index, chosenModel);
            if (index == 4) edit.putString("provider.customBase", chosenBase);
            edit.apply();
            provider = index; model = chosenModel; baseUrl = chosenBase; apiKey = chosenKey;
            String draft = input == null ? "" : input.getText().toString();
            dialog.dismiss(); buildChat(); input.setText(draft);
        });
    }

    // ------------------------------------------------------------------- chat

    private void buildChat() {
        stopAscii();
        LinearLayout root = column(); root.setBackgroundColor(BG); insetPad(root);
        LinearLayout top = row(); top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(12), dp(6), dp(12), dp(6)); top.setBackgroundColor(BG);
        top.addView(iconButton("menu", "Open chats", INK, () -> openDrawer()), new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout titles = column();
        TextView brand = label("Ruqenai", 18, INK);
        brand.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); titles.addView(brand);
        titleLabel = label(chatName.isEmpty() ? "Your ideas, in motion." : chatName, 12, MUTED);
        titleLabel.setSingleLine(); titleLabel.setEllipsize(android.text.TextUtils.TruncateAt.END); titles.addView(titleLabel);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1f);
        titleParams.setMarginStart(dp(8)); top.addView(titles, titleParams);
        top.addView(iconButton("edit", "New chat", INK, () -> { if (!sending) newChat(); }), new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(top);
        View rule = new View(this); rule.setBackgroundColor(RULE); root.addView(rule, new LinearLayout.LayoutParams(-1, dp(1)));

        scroller = new ScrollView(this); scroller.setFillViewport(true);
        scroller.setVerticalScrollBarEnabled(false); scroller.setClipToPadding(false);
        int gutter = Math.max(20, (int)(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density - 720) / 2);
        scroller.setPadding(dp(gutter), dp(24), dp(gutter), dp(20));
        messageList = column(); messageList.setGravity(Gravity.CENTER);
        scroller.addView(messageList, new ScrollView.LayoutParams(-1, -2));
        root.addView(scroller, new LinearLayout.LayoutParams(-1, 0, 1f));

        LinearLayout dock = column(); dock.setPadding(dp(gutter - 4), 0, dp(gutter - 4), dp(8));
        LinearLayout composer = column(); composer.setBackground(card(SURFACE, 24, RULE));
        composer.setPadding(dp(8), dp(6), dp(8), dp(6));
        input = new EditText(this); input.setHint("Ask anything, or build something…");
        input.setHintTextColor(MUTED); input.setTextColor(INK); input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        input.setPadding(dp(12), dp(12), dp(12), dp(12)); input.setBackground(null);
        input.setMinLines(2); input.setMaxLines(5); input.setGravity(Gravity.TOP);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setContentDescription("Message Ruqenai"); composer.addView(input, new LinearLayout.LayoutParams(-1, -2));
        attachTray = column(); attachTray.setVisibility(View.GONE);
        composer.addView(attachTray, new LinearLayout.LayoutParams(-1, 0));
        LinearLayout tools = row(); tools.setGravity(Gravity.CENTER_VERTICAL);
        tools.addView(iconButton("plus", "Add attachment", MUTED, () -> openAttachSheet()), new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView chip = label(modelShort(), 12, INK); chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setPadding(dp(8), 0, dp(8), 0); chip.setMinHeight(dp(48));
        chip.setCompoundDrawables(null,null,icon("chevron",MUTED,16),null); chip.setCompoundDrawablePadding(dp(6));
        chip.setBackground(new RippleDrawable(ColorStateList.valueOf(RULE), card(Color.TRANSPARENT,12,Color.TRANSPARENT),null));
        chip.setSingleLine(); chip.setEllipsize(android.text.TextUtils.TruncateAt.END);
        chip.setContentDescription("Choose API provider and model. " + modelShort()); chip.setOnClickListener(v -> keyDialog());
        tools.addView(chip, new LinearLayout.LayoutParams(0, -2, 1f));
        sendButton = iconButton("send", "Send message", DARK_INK, () -> { if (sending) stopReply(); else sendMessage(); });
        sendButton.setBackground(new RippleDrawable(ColorStateList.valueOf(MUTED),circle(COPPER,24),null));
        tools.addView(sendButton,new LinearLayout.LayoutParams(dp(48),dp(48))); composer.addView(tools);
        dock.addView(composer, new LinearLayout.LayoutParams(-1,-2));
        TextView note = label("Ruqenai can make mistakes. Check important details.", 11, MUTED);
        note.setGravity(Gravity.CENTER); note.setPadding(0,dp(10),0,dp(2)); dock.addView(note);
        root.addView(dock);
        android.widget.FrameLayout stage = new android.widget.FrameLayout(this);
        stage.setBackgroundColor(BG);
        if (sceneView != null) { sceneView.destroy(); sceneView = null; }
        sceneView = new android.webkit.WebView(this);
        sceneView.setBackgroundColor(Color.TRANSPARENT);
        sceneView.getSettings().setJavaScriptEnabled(true);
        sceneView.getSettings().setAllowContentAccess(false);
        sceneView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        updateSceneOpacity();
        sceneView.setWebViewClient(new android.webkit.WebViewClient() {
            @Override public void onPageFinished(android.webkit.WebView view, String url) { applyScene(); }
        });
        stage.addView(sceneView, new android.widget.FrameLayout.LayoutParams(-1,-1));
        root.setBackgroundColor(Color.TRANSPARENT);
        stage.addView(root,new android.widget.FrameLayout.LayoutParams(-1,-1));
        sceneView.loadUrl("file:///android_asset/scenes.html");
        setContentView(stage); renderMessages(); restoreAttachmentChip(); paintSend();
        enter(dock, 14, 280);
    }

    private void renderMessages() {
        if (messageList == null) return;
        messageList.removeAllViews();
        updateSceneOpacity();
        if (messages.length() == 0) {
            messageList.addView(heroBlock());
            return;
        }
        for (int i = 0; i < messages.length(); i += 1) {
            JSONObject message = messages.optJSONObject(i);
            if (message != null) bubble(message.optString("role"), message.optString("content") + (message.optString("error").isEmpty() ? "" : "\n\n" + message.optString("error")), false);
        }
        scrollToEnd();
    }

    private View heroBlock() {
        LinearLayout block = column(); block.setGravity(Gravity.CENTER);
        block.setPadding(0, dp(12), 0, dp(28));
        ImageView mark = new ImageView(this); mark.setImageResource(R.drawable.logo_mark);
        block.addView(mark, new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView art = new TextView(this); art.setTypeface(Typeface.MONOSPACE);
        art.setTextSize(TypedValue.COMPLEX_UNIT_SP, 7.5f); art.setTextColor(INK);
        art.setAlpha(0.72f); art.setGravity(Gravity.CENTER); art.setIncludeFontPadding(false);
        art.setLineSpacing(0f, 0.90f); art.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        art.setVisibility(View.GONE); gap(block, 24);
        TextView title = label("What are we building?", 28, INK);
        title.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        title.setGravity(Gravity.CENTER); block.addView(title);
        gap(block, 10);
        TextView hint = label("A little curiosity. A lot of possibility.", 14, MUTED);
        hint.setGravity(Gravity.CENTER); block.addView(hint); gap(block, 28);
        block.addView(starter("code", "Build something", "Help me plan a small app I can build today."));
        gap(block, 8);
        block.addView(starter("chat", "Think it through", "Help me think through an idea. Ask me where to start."));
        enter(block, 12, 380);
        return block;
    }

    private CharSequence styled(String raw) {
        return MessageText.render(raw, dark ? 0xFF91B9F3 : 0xFF245B9E, PANEL);
    }

    private TextView dangerButton(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        view.setTextColor(dark ? 0xFFE58279 : 0xFFB4342A);
        view.setGravity(Gravity.CENTER);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        view.setPadding(dp(14), dp(13), dp(14), dp(13));
        GradientDrawable shape = card(0x1AFF6B6B, 14, 0x59FF8A80);
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33FF8A80), shape, null));
        return view;
    }

    private TextView shimmerText(String label) {
        MotionViews.Shimmer view = new MotionViews.Shimmer(this, MUTED, INK);
        view.setText(label); view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        view.setPadding(dp(4), dp(16), dp(4), dp(16));
        view.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        return view;
    }

    private TextView bubble(String role, String content, boolean streaming) {
        messageList.setGravity(Gravity.TOP); boolean mine = "user".equals(role);
        LinearLayout holder = column();
        if (!mine) {
            TextView author = label("Ruqenai", 12, MUTED);
            author.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            holder.addView(author); gap(holder, 10);
        }
        TextView text = new TextView(this); text.setText(styled(content));
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP,16); text.setTextColor(INK);
        text.setLineSpacing(dp(4), 1f); text.setTextIsSelectable(true);
        if (mine) { text.setPadding(dp(16),dp(12),dp(16),dp(12)); text.setBackground(card(PANEL,20,PANEL)); }
        LinearLayout wrapper = row(); wrapper.setGravity(mine ? Gravity.END : Gravity.START);
        text.setMaxWidth((int)(getResources().getDisplayMetrics().widthPixels * (mine ? .80f : .92f)));
        wrapper.addView(text, new LinearLayout.LayoutParams(-2,-2)); holder.addView(wrapper);
        gap(holder, 26); messageList.addView(holder);
        if (streaming) { streamingBubble = text; enter(holder,8,220); }
        if (!mine && !streaming) renderReply(text, content);
        return text;
    }

    private static final java.util.regex.Pattern FENCED_BLOCK = java.util.regex.Pattern.compile(
        "(?m)^ {0,3}(`{3,}|~{3,})[ \\t]*([^\\n]*)\\R([\\s\\S]*?)^ {0,3}\\1[ \\t]*(?:\\R|$)");
    private static final java.util.regex.Pattern CODE_TOKEN = java.util.regex.Pattern.compile(
        "(?m)(//[^\\n]*|#[^\\n]*|/\\*[\\s\\S]*?\\*/)|(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')|\\b(class|def|function|return|import|from|const|let|var|public|private|static|new|if|else|for|while|try|catch|async|await|true|false|null|None|True|False|int|void|String|print)\\b|\\b(0x[0-9a-fA-F]+|[0-9]+(?:\\.[0-9]+)?)\\b");

    private void renderReply(TextView original, String content) {
        java.util.regex.Matcher blocks = FENCED_BLOCK.matcher(content);
        if (!blocks.find()) { original.setText(styled(content)); return; }
        LinearLayout wrapper = (LinearLayout) original.getParent();
        LinearLayout reply = column();
        wrapper.removeAllViews(); wrapper.addView(reply, new LinearLayout.LayoutParams(-1, -2));
        int start = 0;
        do {
            appendProse(reply, content.substring(start, blocks.start()));
            appendCodeBox(reply, blocks.group(2).trim(), blocks.group(3).replaceFirst("\\r?\\n$", ""));
            start = blocks.end();
        } while (blocks.find());
        appendProse(reply, content.substring(start));
    }

    private void appendProse(LinearLayout reply, String value) {
        if (value.trim().isEmpty()) return;
        TextView paragraph = label("", 16, INK);
        paragraph.setText(styled(value.trim())); paragraph.setTextIsSelectable(true);
        paragraph.setLineSpacing(dp(4), 1f); reply.addView(paragraph); gap(reply, 12);
    }

    private void appendCodeBox(LinearLayout reply, String type, String value) {
        String tag = type.isEmpty() ? "Code" : type;
        boolean plain = tag.matches("(?i)(text|plaintext|txt|.*\\.txt)");
        LinearLayout box = column(); box.setBackground(card(SURFACE, 14, RULE));
        LinearLayout header = row(); header.setGravity(Gravity.CENTER_VERTICAL);
        TextView name = label(tag, 13, MUTED);
        name.setSingleLine(); name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        name.setPadding(dp(14), 0, 0, 0); header.addView(name, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView copy = drawerRow("Copy", () -> {
            android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText(tag, value));
        });
        header.addView(copy); box.addView(header);
        TextView body = label("", 14, INK);
        body.setTypeface(Typeface.MONOSPACE); body.setPadding(dp(14), dp(4), dp(14), dp(14));
        android.text.SpannableString colored = new android.text.SpannableString(value);
        if (!plain) {
            int[] colors = dark ? new int[]{0xFF9CA692, 0xFFAAD293, 0xFFD5AEF4, 0xFFFFC58A}
                : new int[]{0xFF52604C, 0xFF365E20, 0xFF7132A0, 0xFF814814};
            java.util.regex.Matcher token = CODE_TOKEN.matcher(value);
            while (token.find()) for (int i = 1; i <= colors.length; i++) {
                if (token.group(i) == null) continue;
                colored.setSpan(new android.text.style.ForegroundColorSpan(colors[i-1]), token.start(), token.end(), 33);
                break;
            }
        }
        body.setText(colored); body.setTextIsSelectable(true);
        if (plain) box.addView(body);
        else {
            android.widget.HorizontalScrollView horizontal = new android.widget.HorizontalScrollView(this);
            horizontal.addView(body); box.addView(horizontal);
        }
        reply.addView(box, new LinearLayout.LayoutParams(-1, -2)); gap(reply, 12);
    }

    private void sendMessage() {
        final String typed = input.getText().toString().trim();
        final android.net.Uri attachment = pendingAttachment;
        final String filename = pendingAttachmentName;
        if (sending || loadingAttachment || (typed.isEmpty() && attachment == null)) return;
        if (attachment == null) { commitMessage(typed, null); return; }
        loadingAttachment = true;
        sendButton.setEnabled(false);
        input.setEnabled(false);
        new Thread(() -> {
            String contents = null;
            String failure = null;
            try (InputStream stream = getContentResolver().openInputStream(attachment)) {
                if (stream == null) throw new java.io.IOException("Could not open the attachment.");
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                for (int count; (count = stream.read(buffer)) != -1;) {
                    if (bytes.size() + count > 65536) throw new java.io.IOException("Text files must be 64 KB or smaller.");
                    bytes.write(buffer, 0, count);
                }
                contents = StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString();
                if (contents.indexOf(0) >= 0) throw new java.io.IOException("This file is not plain text.");
            } catch (java.nio.charset.CharacterCodingException error) {
                failure = "Choose a UTF-8 text or source-code file.";
            } catch (Exception error) { failure = text(error); }
            final String fileText = contents, issue = failure;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                loadingAttachment = false;
                sendButton.setEnabled(true);
                input.setEnabled(true);
                if (issue != null) { input.setError(issue); return; }
                if (pendingAttachment == attachment) {
                    pendingAttachment = null; pendingAttachmentName = ""; restoreAttachmentChip();
                    commitMessage((typed.isEmpty() ? "" : typed + "\n\n") + "Attachment: " + filename, fileText);
                }
            });
        }, "Ruqenai-attachment").start();
    }

    private void commitMessage(String text, String attachmentText) {
        sending = true; stopped = false; stopAscii(); paintSend();
        input.setText("");
        hideKeyboard();

        if (chatId.isEmpty()) {
            chatId = UUID.randomUUID().toString();
            chatName = text.length() > 42 ? text.substring(0, 42) : text;
            if (titleLabel != null) titleLabel.setText(chatName);
        }
        if (messageList != null && messages.length() == 0) messageList.removeAllViews();

        try {
            JSONObject mine = new JSONObject();
            mine.put("role", "user");
            mine.put("content", text);
            if (attachmentText != null) mine.put("attachmentText", attachmentText);
            messages.put(mine);
        } catch (Exception ignored) { }

        if (messageList != null) {
            bubble("user", text, false);
            scrollToEnd();
        }
        updateSceneOpacity();
        saveChats();
        startStream();
    }

    private void startStream() {
        final JSONArray payload = new JSONArray();
        try {
            payload.put(new JSONObject().put("role","system").put("content","You are Ruqenai, a concise, capable coding assistant. Use fenced Markdown blocks for standalone code or requested text file contents. Use the language ID for code and the filename for plain text files."));
            for(int i=0;i<messages.length();i++) {
                JSONObject m=messages.optJSONObject(i);
                if (m == null || m.optString("content").isEmpty()) continue;
                String content = m.optString("content");
                if (m.has("attachmentText")) content += "\n\nAttached file contents:\n" + m.getString("attachmentText");
                payload.put(new JSONObject().put("role", m.optString("role")).put("content", content));
            }
        } catch(Exception ignored){}
        final TextView shimmer=shimmerText("Thinking…"); thinkingView=shimmer;
        messageList.addView(shimmer); scrollToEnd();
        final TextView[] live={null};
        final String requestModel=model, requestKey=apiKey, requestUrl=baseUrl + "/chat/completions";
        new Thread(()->{
            HttpURLConnection connection=null;
            StringBuilder answer=new StringBuilder(); String failure=null;
            try {
                connection=(HttpURLConnection)new URL(requestUrl).openConnection();activeConnection=connection;
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(20000);connection.setReadTimeout(120000);
                connection.setRequestMethod("POST");connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Authorization","Bearer "+requestKey);
                JSONObject body=new JSONObject().put("model",requestModel).put("messages",payload).put("stream",true);
                if(stopped)throw new java.io.IOException("Reply stopped.");
                try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
                int status = connection.getResponseCode();
                if (status == 401 || status == 403) throw new java.io.IOException("The provider rejected this API key. Check API providers and try again.");
                if (status < 200 || status >= 300) throw new java.io.IOException("HTTP " + status + " · " + apiError(read(connection)));
                try(BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8))){
                    String line;
                    while(!stopped && (line=reader.readLine())!=null){
                        if(!line.startsWith("data:"))continue;
                        String data=line.substring(5).trim();if("[DONE]".equals(data))break;if(data.isEmpty())continue;
                        JSONObject event=new JSONObject(data);
                        if (event.has("error")) throw new java.io.IOException(apiError(data));
                        JSONArray choices=event.optJSONArray("choices");if(choices==null||choices.length()==0)continue;
                        JSONObject delta=choices.getJSONObject(0).optJSONObject("delta");if(delta==null)continue;
                        String piece=delta.isNull("content") ? "" : delta.optString("content","");
                        if(piece.isEmpty())continue;
                        answer.append(piece);final String shown=answer.toString();
                        runOnUiThread(()->{
                            if(isDestroyed())return;
                            messageList.removeView(shimmer);
                            if(live[0]==null)live[0]=bubble("assistant","",true);
                            live[0].setText(styled(shown));scrollToEnd();
                        });
                    }
                }
                if(answer.length()==0 && !stopped)throw new java.io.IOException("The model returned no text. Try again.");
            }catch(Exception error){failure=stopped?"Reply stopped.":text(error);}
            finally{if(connection!=null)connection.disconnect();activeConnection=null;}
            final String done=answer.toString(), problem=stopped?"Reply stopped.":failure;
            try{messages.put(new JSONObject().put("role","assistant").put("content",done).put("error",problem==null?"":problem));}catch(Exception ignored){}
            saveChats();
            runOnUiThread(()->{
                if(isDestroyed())return;
                messageList.removeView(shimmer);thinkingView=null;
                if(live[0]==null)live[0]=bubble("assistant","",true);
                renderReply(live[0], done+(problem==null?"":(done.isEmpty()?"":"\n\n")+problem));
                if(problem!=null&&done.isEmpty())live[0].setTextColor(MUTED);
                sending=false;paintSend();scrollToEnd();
            });
        },"Ruqenai-reply").start();
    }

    private void scrollToEnd() {
        if (scroller == null) return;
        scroller.post(() -> { if (scroller != null) scroller.fullScroll(View.FOCUS_DOWN); });
    }

    private void hideKeyboard() {
        InputMethodManager manager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (manager != null && input != null) manager.hideSoftInputFromWindow(input.getWindowToken(), 0);
    }

    // ----------------------------------------------------------------- drawer

    private void openDrawer() {
        final Dialog dialog = new Dialog(this); dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout panel = column(); panel.setBackgroundColor(SURFACE);
        panel.setPadding(dp(16),dp(16)+statusBar(),dp(16),dp(16)+navBar());
        LinearLayout header = row(); header.setGravity(Gravity.CENTER_VERTICAL);
        TextView brand = label("Ruqenai",24,INK); brand.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        header.addView(brand,new LinearLayout.LayoutParams(0,-2,1f));
        header.addView(iconButton("close","Close chats",MUTED,dialog::dismiss),new LinearLayout.LayoutParams(dp(48),dp(48)));
        panel.addView(header); gap(panel,24);
        TextView create = drawerRow("New conversation", () -> { dialog.dismiss(); newChat(); });
        create.setCompoundDrawables(icon("plus",INK,20),null,null,null); create.setCompoundDrawablePadding(dp(12));
        create.setBackground(new RippleDrawable(ColorStateList.valueOf(RULE),card(PANEL,14,RULE),null));
        panel.addView(create); gap(panel,28); panel.addView(label("Conversations",13,MUTED)); gap(panel,12);
        ScrollView list = new ScrollView(this); list.setVerticalScrollBarEnabled(false);
        LinearLayout rows = column();
        if (chats.length()==0) { TextView empty = label("Your next idea starts here.\nCreate a conversation to get going.",14,MUTED);
            empty.setPadding(dp(8),dp(16),dp(8),dp(16)); empty.setLineSpacing(dp(4),1f); rows.addView(empty); }
        java.util.ArrayList<JSONObject> ordered = new java.util.ArrayList<>();
        for(int i=0;i<chats.length();i++){JSONObject c=chats.optJSONObject(i);if(c!=null&&c.optBoolean("pinned"))ordered.add(c);}
        for(int i=chats.length()-1;i>=0;i--){JSONObject c=chats.optJSONObject(i);if(c!=null&&!c.optBoolean("pinned"))ordered.add(c);}
        for (JSONObject chat : ordered) {
            final String id=chat.optString("id"), name=chat.optString("name","Untitled");
            LinearLayout entry=row(); entry.setGravity(Gravity.CENTER_VERTICAL);
            if(id.equals(chatId))entry.setBackground(card(PANEL,12,PANEL));
            TextView item=drawerRow((chat.optBoolean("pinned") ? "Pinned · " : "")+name,()->{dialog.dismiss();openChat(id);});
            item.setCompoundDrawables(icon("chat",MUTED,18),null,null,null); item.setCompoundDrawablePadding(dp(12));
            item.setOnLongClickListener(v->{dialog.dismiss();chatOptions(null,id,name);return true;});
            entry.addView(item,new LinearLayout.LayoutParams(0,-2,1f));
            TextView more=iconButton("chevron","Options for "+name,MUTED,()->{dialog.dismiss();chatOptions(null,id,name);});
            entry.addView(more,new LinearLayout.LayoutParams(dp(48),dp(48))); rows.addView(entry);
        }
        list.addView(rows); panel.addView(list,new LinearLayout.LayoutParams(-1,0,1f)); gap(panel,16);
        View rule=new View(this);rule.setBackgroundColor(RULE);panel.addView(rule,new LinearLayout.LayoutParams(-1,dp(1)));gap(panel,8);
        panel.addView(drawerRow("Appearance · "+(dark?"Ink":"Porcelain"),()->{dialog.dismiss();toggleTheme();}));
        panel.addView(drawerRow("Background scene",()->{dialog.dismiss();chooseScene();}));
        panel.addView(drawerRow("API providers",()->{dialog.dismiss();keyDialog();}));
        TextView foot=label("On-device history",11,MUTED);foot.setPadding(dp(14),dp(12),0,0);panel.addView(foot);
        dialog.setContentView(panel);dialog.show();
        Window window=dialog.getWindow();
        if(window!=null){window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));window.setDimAmount(.6f);
            window.setGravity(Gravity.START);window.setLayout(Math.min(dp(360),getResources().getDisplayMetrics().widthPixels-dp(36)),-1);}
        if(motion()){panel.setTranslationX(-dp(40));panel.setAlpha(0f);panel.animate().translationX(0).alpha(1).setDuration(280).setInterpolator(new DecelerateInterpolator(2f)).start();}
    }

    private TextView drawerRow(String text, Runnable action) {
        TextView row = label(text, 14.5f, INK);
        row.setMinHeight(dp(52)); row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        row.setSingleLine();
        row.setEllipsize(android.text.TextUtils.TruncateAt.END);
        GradientDrawable background = card(Color.TRANSPARENT, 12, Color.TRANSPARENT);
        row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), background, null));
        row.setOnClickListener(v -> action.run());
        return row;
    }

    private int chatIndex(String id) {
        for (int i = 0; i < chats.length(); i += 1) {
            JSONObject chat = chats.optJSONObject(i);
            if (chat != null && id.equals(chat.optString("id"))) return i;
        }
        return -1;
    }

    private void chatOptions(final Dialog drawer, final String id, final String name) {
        if (sending) { toast("Finish the reply before changing this chat."); return; }
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout sheet = column();
        sheet.setBackground(card(PANEL, 22, RULE));
        sheet.setPadding(dp(14), dp(16), dp(14), dp(20) + navBar());
        sheet.addView(label("Chat", 10, MUTED));
        gap(sheet, 8);
        TextView heading = label(name, 15, INK);
        heading.setSingleLine();
        heading.setEllipsize(android.text.TextUtils.TruncateAt.END);
        sheet.addView(heading);
        gap(sheet, 14);

        sheet.addView(drawerRow("Rename", () -> { dialog.dismiss(); renameChat(id, name); }));
        gap(sheet, 4);
        JSONObject record = chats.optJSONObject(chatIndex(id));
        boolean pinned = record != null && record.optBoolean("pinned", false);
        sheet.addView(drawerRow(pinned ? "Unpin from top" : "Pin to top", () -> { dialog.dismiss(); togglePin(id); }));
        gap(sheet, 4);
        TextView remove = dangerButton("Delete chat");
        remove.setOnClickListener(v -> { dialog.dismiss(); confirmDelete(drawer, id, name); });
        gap(sheet, 10);
        sheet.addView(remove);

        dialog.setContentView(sheet);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setDimAmount(0.55f);
            window.setGravity(Gravity.BOTTOM);
            window.setLayout(-1, -2);
        }
        dialog.show();
        if(window!=null)window.setLayout(-1,-2);
        animateSheet(sheet);
    }

    private void renameChat(final String id, String current) {
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout panel = column();
        panel.setBackground(card(PANEL, 22, RULE));
        panel.setPadding(dp(18), dp(18), dp(18), dp(18));
        panel.addView(label("Rename chat", 11, MUTED));
        gap(panel, 12);
        final EditText field = this.field(current);
        field.setSingleLine();
        panel.addView(field, new LinearLayout.LayoutParams(-1, -2));
        gap(panel, 14);
        TextView save = primary("Save");
        save.setOnClickListener(v -> {
            String value = field.getText().toString().trim();
            if (value.isEmpty()) { toast("Give it a name."); return; }
            JSONObject chat = chats.optJSONObject(chatIndex(id));
            if (chat != null) {
                try { chat.put("name", value); } catch (Exception ignored) { }
                prefs.edit().putString("chats", chats.toString()).apply();
            }
            if (id.equals(chatId)) chatName = value;
            dialog.dismiss();
            if (id.equals(chatId)) buildChat(); else openDrawer();
        });
        panel.addView(save, new LinearLayout.LayoutParams(-1, -2));
        dialog.setContentView(panel);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setDimAmount(0.55f);
            window.setGravity(Gravity.BOTTOM);
            window.setLayout(-1, -2);
        }
        dialog.show();
    }

    private void togglePin(String id) {
        int index = chatIndex(id);
        JSONObject chat = chats.optJSONObject(index);
        if (chat == null) return;
        boolean pinned = chat.optBoolean("pinned", false);
        try { chat.put("pinned", !pinned); } catch (Exception ignored) { }
        if (!pinned) {
            JSONArray reordered = new JSONArray();
            reordered.put(chat);
            for (int i = 0; i < chats.length(); i += 1) {
                if (i == index) continue;
                JSONObject other = chats.optJSONObject(i);
                if (other != null) reordered.put(other);
            }
            chats = reordered;
        }
        prefs.edit().putString("chats", chats.toString()).apply();
        openDrawer();
    }

    private void confirmDelete(final Dialog drawer, final String id, String name) {
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout panel = column();
        panel.setBackground(card(PANEL, 22, RULE));
        panel.setPadding(dp(18), dp(18), dp(18), dp(18));
        panel.addView(label("Delete chat", 11, MUTED));
        gap(panel, 10);
        panel.addView(label("\u201C" + name + "\u201D and its messages will be removed from this phone.", 13, INK));
        gap(panel, 16);
        LinearLayout actions = row();
        TextView cancel = ghostButton("Cancel");
        cancel.setOnClickListener(v -> dialog.dismiss());
        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(0, -2);
        cancelParams.weight = 1f;
        actions.addView(cancel, cancelParams);
        TextView confirm = dangerButton("Delete");
        confirm.setOnClickListener(v -> {
            int index = chatIndex(id);
            if (index >= 0) chats.remove(index);
            prefs.edit().putString("chats", chats.toString()).apply();
            if (id.equals(chatId)) {
                chatId = "";
                chatName = "";
                messages = new JSONArray();
                StreamingReset();
            }
            dialog.dismiss();
            if (drawer != null && drawer.isShowing()) drawer.dismiss();
            if (apiKey.isEmpty()) buildGate(); else buildChat();
        });
        LinearLayout.LayoutParams confirmParams = new LinearLayout.LayoutParams(0, -2);
        confirmParams.weight = 1f;
        confirmParams.setMarginStart(dp(8));
        actions.addView(confirm, confirmParams);
        panel.addView(actions);
        dialog.setContentView(panel);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setDimAmount(0.6f);
            window.setGravity(Gravity.CENTER);
            window.setLayout(Math.round(getResources().getDisplayMetrics().widthPixels * 0.88f), -2);
        }
        dialog.show();
        animateSheet(panel);
    }
    private TextView ghostButton(String caption) {
        TextView view = new TextView(this);
        view.setText(caption);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        view.setTextColor(INK);
        view.setGravity(Gravity.CENTER);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        view.setPadding(dp(14), dp(13), dp(14), dp(13));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), card(PANEL, 14, RULE), null));
        return view;
    }

    private void toggleTheme() {
        if(sending || loadingAttachment){toast("Wait for the current message to finish.");return;}
        String draft=input==null?"":input.getText().toString();
        dark = !dark;
        prefs.edit().putBoolean("dark", dark).apply();
        applyPalette();
        if (apiKey.isEmpty()) buildGate(); else { buildChat(); input.setText(draft); }
    }

    private void newChat() {
        if(sending || loadingAttachment){toast("Wait for the current message to finish.");return;}
        chatId = "";
        chatName = "";
        messages = new JSONArray();
        StreamingReset();
        if (apiKey.isEmpty()) buildGate(); else buildChat();
    }

    private void StreamingReset() {
        sending = false;
        streamingBubble = null;
    }

    private void openChat(String id) {
        if(sending){toast("Stop the reply before opening another chat.");return;}
        for (int i = 0; i < chats.length(); i += 1) {
            JSONObject chat = chats.optJSONObject(i);
            if (chat == null || !id.equals(chat.optString("id"))) continue;
            chatId = id;
            chatName = chat.optString("name", "Untitled");
            messages = chat.optJSONArray("messages");
            if (messages == null) messages = new JSONArray();
            break;
        }
        buildChat();
    }

    // -------------------------------------------------------------- attachments

    /** Ribbon-like open: rises past its resting point, then settles. */
    private void animateSheet(final View sheet) {
        if (!motion()) return;
        sheet.setTranslationY(dp(220));
        sheet.setAlpha(0f);
        sheet.setScaleX(0.97f);
        sheet.setScaleY(0.97f);
        sheet.animate()
                .translationY(0f)
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(300)
                .setInterpolator(new android.view.animation.OvershootInterpolator(0.85f))
                .start();
    }

    private void openAttachSheet() {
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout sheet = column();
        sheet.setBackground(card(PANEL, 22, RULE));
        sheet.setPadding(dp(14), dp(16), dp(14), dp(22));

        View handle = new View(this);
        GradientDrawable handleBg = new GradientDrawable();
        handleBg.setColor(RULE);
        handleBg.setCornerRadius(dp(3));
        handle.setBackground(handleBg);
        LinearLayout.LayoutParams handleParams = new LinearLayout.LayoutParams(dp(38), dp(4));
        handleParams.gravity = Gravity.CENTER_HORIZONTAL;
        sheet.addView(handle, handleParams);

        gap(sheet, 14);
        sheet.addView(drawerRow("Attach a text or source-code file", () -> { dialog.dismiss(); launchFiles(); }));

        dialog.setContentView(sheet);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setDimAmount(0.5f);
            window.setGravity(Gravity.BOTTOM);
            window.setLayout(-1, -2);
        }
        dialog.show();
        animateSheet(sheet);
    }

    private android.net.Uri pendingAttachment;
    private LinearLayout attachTray;
    private String pendingAttachmentName = "";

    /** Staged file lives in a tray that expands upward, with a Remove control. */
    private void restoreAttachmentChip() {
        if (attachTray == null) return;
        attachTray.removeAllViews();
        if (pendingAttachment == null) {
            final int from = attachTray.getHeight();
            if (from <= 0) {
                attachTray.setVisibility(View.GONE);
                return;
            }
            android.animation.ValueAnimator collapse = android.animation.ValueAnimator.ofInt(from, 0);
            collapse.setDuration(180);
            collapse.addUpdateListener(animation -> {
                attachTray.getLayoutParams().height = (int) animation.getAnimatedValue();
                attachTray.requestLayout();
            });
            collapse.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(android.animation.Animator animation) {
                    attachTray.setVisibility(View.GONE);
                }
            });
            collapse.start();
            return;
        }

        LinearLayout chip = row();
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setBackground(card(SURFACE, 16, RULE));
        chip.setPadding(dp(12), dp(7), dp(6), dp(7));

        TextView name = label(pendingAttachmentName.isEmpty() ? "Attachment" : pendingAttachmentName, 12, INK);
        name.setSingleLine();
        name.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(0, -2);
        nameParams.weight = 1f;
        chip.addView(name, nameParams);

        TextView remove = label("Remove", 12, MUTED);
        remove.setMinHeight(dp(48)); remove.setGravity(Gravity.CENTER);
        remove.setPadding(dp(10), dp(5), dp(10), dp(5));
        remove.setOnClickListener(v -> {
            pendingAttachment = null;
            pendingAttachmentName = "";
            restoreAttachmentChip();
        });
        chip.addView(remove);

        attachTray.addView(chip);
        attachTray.setVisibility(View.VISIBLE);
        attachTray.post(() -> {
            attachTray.measure(
                    View.MeasureSpec.makeMeasureSpec(attachTray.getWidth(), View.MeasureSpec.AT_MOST),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            final int target = attachTray.getMeasuredHeight();
            android.animation.ValueAnimator expand = android.animation.ValueAnimator.ofInt(0, target);
            expand.setDuration(220);
            expand.setInterpolator(new android.view.animation.DecelerateInterpolator());
            expand.addUpdateListener(animation -> {
                attachTray.getLayoutParams().height = (int) animation.getAnimatedValue();
                attachTray.requestLayout();
            });
            expand.start();
        });
    }

    private void launchCamera() {
        try {
            android.content.ContentValues values = new android.content.ContentValues();
            values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                    "ruqenai-" + System.currentTimeMillis() + ".jpg");
            values.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            pendingAttachment = getContentResolver().insert(
                    android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            android.content.Intent intent = new android.content.Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            if (pendingAttachment != null) {
                intent.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, pendingAttachment);
                intent.addFlags(android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            }
            startActivityForResult(intent, 41);
        } catch (Exception error) {
            pendingAttachment = null;
            toast("No camera app.");
        }
    }

    private void launchPhotos() {
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT);
        intent.setType("image/*");
        startActivityForResult(android.content.Intent.createChooser(intent, "Pick a photo"), 42);
    }

    private void launchFiles() {
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT);
        intent.setType("*/*");
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
        startActivityForResult(android.content.Intent.createChooser(intent, "Attach a file"), 43);
    }

    @Override
    protected void onActivityResult(int request, int result, android.content.Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK) {
            pendingAttachment = null;
            restoreAttachmentChip();
            return;
        }
        android.net.Uri uri = request == 41
                ? pendingAttachment
                : (data != null ? data.getData() : null);
        if (uri == null) {
            toast("Nothing attached.");
            return;
        }
        String name = request == 43 ? "File" : "Photo";
        try (android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) { }
        pendingAttachment = uri;
        pendingAttachmentName = name;
        restoreAttachmentChip();
        toast("Attached: " + name);
    }

    // -------------------------------------------------------------- persistence

    private void loadChats() {
        try { chats = new JSONArray(prefs.getString("chats", "[]")); } catch (Exception error) { chats = new JSONArray(); }
    }

    private void saveChats() {
        if (chatId.isEmpty()) return;
        try {
            JSONObject record = new JSONObject();
            record.put("id", chatId);
            record.put("name", chatName.isEmpty() ? "New chat" : chatName);
            record.put("messages", messages);
            JSONObject previous = chats.optJSONObject(chatIndex(chatId));
            record.put("pinned", previous != null && previous.optBoolean("pinned", false));
            boolean replaced = false;
            for (int i = 0; i < chats.length(); i += 1) {
                JSONObject chat = chats.optJSONObject(i);
                if (chat != null && chatId.equals(chat.optString("id"))) { chats.put(i, record); replaced = true; break; }
            }
            if (!replaced) chats.put(record);
            prefs.edit().putString("chats", chats.toString()).apply();
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ views

    /** Keeps content clear of the status and navigation bars. */
    private void insetPad(LinearLayout root) {
        final int left=root.getPaddingLeft(), top=root.getPaddingTop(), right=root.getPaddingRight(), bottom=root.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(left + insets.getSystemWindowInsetLeft(), top + insets.getSystemWindowInsetTop(), right + insets.getSystemWindowInsetRight(), bottom + insets.getSystemWindowInsetBottom());
            return insets;
        });
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        return layout;
    }

    private LinearLayout.LayoutParams weightParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48));
        params.weight = 1f;
        return params;
    }

    private void gap(LinearLayout parent, int height) {
        View spacer = new View(this);
        parent.addView(spacer, new LinearLayout.LayoutParams(1, dp(height)));
    }

    private TextView label(String text, float size, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, size);
        view.setTextColor(color);
        return view;
    }

    private TextView glyph(String text, float size, int color) {
        TextView view = label(text, size, color);
        view.setGravity(Gravity.CENTER);
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(RULE), circle(0x00000000, 20), null));
        return view;
    }

    private TextView primary(String text) {
        TextView view = label(text, 14, DARK_INK);
        view.setMinHeight(dp(48)); view.setPadding(dp(16), dp(12), dp(16), dp(12));
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        view.setGravity(Gravity.CENTER);
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), card(COPPER, 24, COPPER), null));
        view.setOnTouchListener((v, event) -> {
            v.animate().scaleX(event.getAction() == 0 ? 0.97f : 1f)
                    .scaleY(event.getAction() == 0 ? 0.97f : 1f).setDuration(120).start();
            return false;
        });
        return view;
    }

    private TextView button(String text, String description, float size, Runnable action) {
        TextView view = label(text, size, INK);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(10), dp(10), dp(10), dp(10));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), card(SURFACE, 24, RULE), null));
        view.setContentDescription(description);
        view.setOnClickListener(v -> action.run());
        return view;
    }

    private EditText field(String hint) {
        EditText view = new EditText(this);
        view.setHint(hint);
        view.setHintTextColor(MUTED);
        view.setTextColor(INK);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f);
        view.setSingleLine(true);
        view.setMinHeight(dp(48));
        view.setPadding(dp(15), dp(13), dp(15), dp(13));
        view.setBackground(card(SURFACE, 14, RULE));
        return view;
    }

    private GradientDrawable card(int fill, int radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        if (stroke != fill) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private GradientDrawable circle(int fill, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(fill);
        return drawable;
    }

    private void toast(String text) {
        android.widget.Toast.makeText(this, text, android.widget.Toast.LENGTH_SHORT).show();
    }

    // ----------------------------------------------------------------- network

    private JSONObject post(String endpoint, String body, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
        }
        String response = read(connection);
        if (connection.getResponseCode() >= 400) throw new Exception(apiError(response));
        return new JSONObject(response.isEmpty() ? "{}" : response);
    }

    private String read(HttpURLConnection connection) throws Exception {
        InputStream stream = connection.getResponseCode() >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) builder.append(line);
        return builder.toString();
    }

    private String apiError(String body) {
        try {
            JSONObject object = new JSONObject(body);
            String message = object.optString("error_description", "");
            if (message.isEmpty()) message = object.optString("msg", "");
            JSONObject detail = object.optJSONObject("error");
            if (message.isEmpty()) message = detail == null ? object.optString("error", "") : detail.optString("message", "The request failed. Check your API key and try again.");
            return message.isEmpty() ? body : message;
        } catch (Exception error) {
            return body;
        }
    }

    private String text(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? "Something went wrong." : message;
    }

    // ------------------------------------------------------- monochrome extras

    private String model = "deepseek-chat";
    private final Handler asciiHandler = new Handler(Looper.getMainLooper());
    private Runnable asciiTask;
    private TextView asciiView;
    private double asciiClock;

    private String modelShort() {
        return PROVIDERS[provider] + " · " + model;
    }

    private int statusBar() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    private int navBar() {
        int id = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(16);
    }

    private void startAscii(final TextView view) {
        stopAscii();
        asciiView = view;
        asciiClock = 0;
        asciiTask = new Runnable() {
            @Override
            public void run() {
                if (asciiView == null) return;
                asciiClock += 0.07;
                asciiView.setText(asciiFrame(asciiClock));
                if (android.animation.ValueAnimator.areAnimatorsEnabled() && hasWindowFocus()) asciiHandler.postDelayed(this, 95);
            }
        };
        asciiHandler.post(asciiTask);
    }

    private void stopAscii() {
        if (asciiTask != null) asciiHandler.removeCallbacks(asciiTask);
        asciiTask = null;
        asciiView = null;
    }

    private String asciiFrame(double t) {
        int cols = 34;
        int rows = 15;
        String ramp = " .:-=+*#%@";
        StringBuilder out = new StringBuilder();
        for (int y = 0; y < rows; y += 1) {
            double v = (y + 0.5) / rows * 2 - 1;
            for (int x = 0; x < cols; x += 1) {
                double u = (x + 0.5) / cols * 2 - 1;
                double r2 = u * u + v * v;
                char cell = ' ';
                if (r2 <= 1.0) {
                    double z = Math.sqrt(Math.max(0, 1 - r2));
                    double px = u * Math.cos(t) - z * Math.sin(t);
                    double light = Math.max(0, px * -0.6 + z * 0.7);
                    double rim = Math.pow(1 - z, 3.2) * 0.5;
                    double value = Math.min(1, light + rim);
                    cell = ramp.charAt((int) Math.round(Math.pow(value, 1.6) * (ramp.length() - 1)));
                }
                if (Math.abs(u) < 0.88) {
                    double ring = (u * u) / 0.72 + (v * v) / 0.045;
                    if (ring > 0.85 && ring < 1.15) {
                        if (v > 0.0) {
                            cell = r2 <= 1.0 ? '=' : '-';
                        } else if (r2 > 1.02) {
                            cell = '.';
                        }
                    }
                }
                out.append(cell);
            }
            out.append('\n');
        }
        return out.toString();
    }

    private boolean motion() { return android.animation.ValueAnimator.areAnimatorsEnabled(); }

    private void enter(View view, int distance, int duration) {
        if (!motion()) return;
        view.setAlpha(0f); view.setTranslationY(dp(distance));
        view.animate().alpha(1f).translationY(0f).setDuration(duration)
            .setInterpolator(new DecelerateInterpolator(2f)).start();
    }

    private android.graphics.drawable.Drawable icon(String name, int color, int size) {
        MotionViews.Icon drawable = new MotionViews.Icon(name, color);
        drawable.setBounds(0,0,dp(size),dp(size)); return drawable;
    }

    private TextView iconButton(String name, String description, int color, Runnable action) {
        TextView view = glyph("", 16, color);
        view.setPadding(dp(12),dp(12),dp(12),dp(12));
        view.setCompoundDrawables(icon(name,color,24),null,null,null);
        view.setContentDescription(description);
        view.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, android.view.accessibility.AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host,info); info.setClassName("android.widget.Button");
            }
        });
        view.setOnClickListener(v -> action.run()); return view;
    }

    private View starter(String symbol, String title, String prompt) {
        TextView view = label(title,14,INK); view.setGravity(Gravity.CENTER_VERTICAL);
        view.setMinHeight(dp(52)); view.setPadding(dp(16),dp(8),dp(16),dp(8));
        view.setCompoundDrawables(icon(symbol,MUTED,20),null,icon("send",MUTED,16),null);
        view.setCompoundDrawablePadding(dp(14));
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(RULE),card(Color.TRANSPARENT,14,RULE),null));
        view.setOnClickListener(v -> { input.setText(prompt); input.setSelection(input.length()); input.requestFocus();
            ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(input,InputMethodManager.SHOW_IMPLICIT); });
        return view;
    }

    private void paintSend() {
        if (sendButton == null) return;
        sendButton.setCompoundDrawables(icon(sending ? "stop" : "send",DARK_INK,24),null,null,null);
        sendButton.setContentDescription(sending ? "Stop reply" : "Send message");
    }

    private void stopReply() {
        stopped = true; HttpURLConnection connection = activeConnection;
        if (connection != null) new Thread(connection::disconnect).start();
    }

    @Override protected void onStop() { super.onStop(); if(asciiTask!=null)asciiHandler.removeCallbacks(asciiTask); }
    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus && asciiView != null && asciiTask != null) { asciiHandler.removeCallbacks(asciiTask); asciiHandler.post(asciiTask); }
        if (focus && thinkingView != null) thinkingView.invalidate();
    }
    private void updateSceneOpacity() {
        if (sceneView != null) sceneView.setAlpha(messages.length() == 0 ? (dark ? .40f : .18f) : (dark ? .12f : .07f));
    }

    private void applyScene() {
        if(sceneView!=null)sceneView.evaluateJavascript("window.scene && window.scene("+prefs.getInt("scene",0)+","+motion()+")",null);
    }
    private void chooseScene() {
        String[] names={"Aurora Fjord","Alpine Dawn","Tokyo Rain","Night Coast","Earthrise","None"};
        new android.app.AlertDialog.Builder(this).setTitle("Background scene")
            .setSingleChoiceItems(names,prefs.getInt("scene",0)<0?5:prefs.getInt("scene",0),(dialog,index)->{
                prefs.edit().putInt("scene",index==5?-1:index).apply();applyScene();dialog.dismiss();
            }).setNegativeButton("Cancel",null).show();
    }
    @Override protected void onPause() { if(sceneView!=null)sceneView.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if(sceneView!=null){sceneView.onResume();applyScene();} }
    @Override protected void onDestroy() { stopReply(); stopAscii(); if(sceneView!=null)sceneView.destroy(); super.onDestroy(); }

}
