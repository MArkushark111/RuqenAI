# Ruqenai for Android

The Android app supports DeepSeek, OpenAI, OpenRouter, Groq, and custom HTTPS endpoints that support OpenAI-style streaming chat completions. Open the provider control in the composer to select a provider, enter its model ID, and save its API key. Chats and provider settings are stored on the device.

The native interface follows the desktop Ink/Porcelain themes, with animated ASCII backgrounds, a conversation drawer, a multiline composer, a streamed thinking shimmer, and a stop control. Fenced code and text replies appear in copyable boxes. UTF-8 text and source-code attachments up to 64 KB are included in the conversation sent to the selected provider.

Build with JDK 17 and Android SDK 37 using `gradlew.bat :app:assembleDebug` from the android folder. The APK is `app/build/outputs/apk/debug/app-debug.apk`. The experimental CLI LAN host and unused Android `LanClient.java` are not wired into this Android UI.
