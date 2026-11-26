# Android interface

Ruqenai for Android inherits the desktop app's Ink and Porcelain identity while using native Android Views and touch targets. The app remains a standalone DeepSeek client; this redesign does not introduce pairing, accounts, or other providers.

## Visual system

Ink uses #131211 background, #1B1A18 composer, #24221F selected/user surfaces, #F1EDE5 foreground, #A9A296 secondary text, and #3A3733 outlines. Porcelain uses #ECEAE4 background, #F8F6F1 composer, #E2DFD7 selected surfaces, #24221F foreground, #696257 secondary text, and #CCC6BA outlines. Typography uses Android sans-serif, sp sizing, 16sp messages, 28sp empty-state title, and 24sp sheet titles.

## Composition and motion

The compact app bar opens a conversation drawer and creates chats. The scrollable center contains an animated monospace sphere and two prompt starters when empty. The bottom composer separates multiline input from attachment, model, and send controls. Assistant replies use open typography; user messages use a tonal bubble. Controls have 48dp touch targets, named icons, and ripple feedback.

The signature motion is a desktop-like thinking shimmer that runs only while visible and respects disabled system animations. The hero rotates slowly; the dock enters over 280ms, the hero over 380ms, and sheets rise over 300ms. Static content remains available with motion disabled. Drawers, model choices, attachments, and appearance use the same palette.

## Verification

Build with the bundled Gradle wrapper and Android SDK. Screenshots under .screenshots/android-redesign are emulator evidence. A real API key is required to verify successful DeepSeek replies. Attachments retain the existing filename-only request behavior.

## Direction contract

THESIS: A native chat workspace in the existing desktop identity, with a clear conversation area and docked composer.

OWN-WORLD: Ink/Porcelain warm neutrals, native sans-serif typography, open assistant replies, tonal user bubbles, and a consistent drawn stroke-icon family.

STORY: Enter a local API key, start an idea, select a model, and revisit a saved conversation.

FIRST VIEWPORT: Compact navigation header, centered animated ASCII sphere and prompt starters, multiline composer with attachment/model/send controls below.

FORM: seed: none (pinned); user requested “similar to desktop app” and “text shimmers like desktop app has”. Native Operate surface built directly from that existing implementation.

FINISH: Native emulator captures, successful APK build, code review, documented visual system, and explicit limits on live-provider verification.
