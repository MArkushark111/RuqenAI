package ai.ruqenai.mobile;

import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

final class LanClient {
    static final int PORT = 41418;
    private static final String DISCOVERY = "RUQENAI_DISCOVER_1";
    final String address, instance;
    private final String token;
    private final SSLContext tls;
    private volatile HttpsURLConnection activeReply;

    record Host(String address, String name, String instance) {}

    static final class HttpFailure extends IOException {
        final int status;
        HttpFailure(int status, String message) { super(message); this.status = status; }
    }

    static String instanceFromCode(String code) {
        if (!code.matches("rq1\\.[A-Za-z0-9_-]{43}\\.[A-Za-z0-9_-]{32}")) {
            throw new IllegalArgumentException("Paste the pairing code from ruqenai pair.");
        }
        return code.split("\\.")[1].substring(0, 16);
    }

    LanClient(String address, String code) throws Exception {
        this.address = address.trim();
        if (!this.address.matches("[A-Za-z0-9.\\-]+(?::[0-9]{1,5})?")) {
            throw new IllegalArgumentException("Enter a PC address such as 192.168.1.25.");
        }
        instance = instanceFromCode(code);
        String[] fields = code.split("\\.");
        byte[] pin = Base64.decode(fields[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        token = fields[2];
        tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[]{new X509TrustManager() {
            @Override public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException {
                throw new CertificateException("Client certificates are unsupported.");
            }
            @Override public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
                if (chain == null || chain.length == 0) throw new CertificateException("Host certificate missing.");
                try {
                    chain[0].checkValidity();
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
                    if (!MessageDigest.isEqual(digest, pin)) throw new CertificateException("Host certificate changed.");
                } catch (Exception error) { throw new CertificateException(error); }
            }
            @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }}, null);
    }

    static Host discover(String pairedInstance) {
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            Set<InetAddress> destinations = new HashSet<>();
            destinations.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                for (InterfaceAddress iface : nic.getInterfaceAddresses()) {
                    if (iface.getBroadcast() != null) destinations.add(iface.getBroadcast());
                }
            }
            byte[] probe = DISCOVERY.getBytes(StandardCharsets.UTF_8);
            for (InetAddress destination : destinations) {
                try { socket.send(new DatagramPacket(probe, probe.length, destination, PORT)); }
                catch (IOException ignored) {}
            }
            long end = android.os.SystemClock.elapsedRealtime() + 1400;
            byte[] bytes = new byte[1024];
            while (android.os.SystemClock.elapsedRealtime() < end) {
                socket.setSoTimeout((int)Math.max(1, end - android.os.SystemClock.elapsedRealtime()));
                DatagramPacket packet = new DatagramPacket(bytes, bytes.length);
                socket.receive(packet);
                JSONObject message;
                try { message = new JSONObject(new String(bytes, 0, packet.getLength(), StandardCharsets.UTF_8)); }
                catch (Exception ignored) { continue; }
                String instance = message.optString("instance");
                if (!DISCOVERY.equals(message.optString("service")) || packet.getPort() != PORT
                    || message.optInt("port") != PORT || !instance.matches("[A-Za-z0-9_-]{16}")) continue;
                if (pairedInstance == null || pairedInstance.equals(instance)) {
                    return new Host(packet.getAddress().getHostAddress() + ":" + PORT,
                        message.optString("name", "Ruqenai"), instance);
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    static String chatPath(String id) {
        return "/v1/chats/" + android.net.Uri.encode(id);
    }

    private HttpsURLConnection request(String path, JSONObject payload, int timeout) throws Exception {
        String host = address.contains(":") ? address : address + ":" + PORT;
        HttpsURLConnection c = (HttpsURLConnection) URI.create("https://" + host + path).toURL().openConnection();
        c.setSSLSocketFactory(tls.getSocketFactory());
        // The pairing code pins the exact certificate, independently of the current LAN address.
        c.setHostnameVerifier((name, session) -> true);
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(3800);
        c.setReadTimeout(timeout);
        c.setRequestProperty("Authorization", "Bearer " + token);
        if (payload != null) {
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            c.setDoOutput(true);
            byte[] data = payload.toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(data.length);
            try (var output = c.getOutputStream()) { output.write(data); }
            catch (Exception error) { c.disconnect(); throw error; }
        }
        return c;
    }

    private InputStream success(HttpsURLConnection c) throws Exception {
        int status = c.getResponseCode();
        if (status >= 200 && status < 300) return c.getInputStream();
        String message = "PC returned HTTP " + status + ".";
        try (var input = c.getErrorStream()) {
            if (input != null) message = new JSONObject(readText(input))
                .optString("error", message);
        } catch (Exception ignored) {}
        throw new HttpFailure(status, message);
    }

    JSONObject json(String path, JSONObject payload) throws Exception {
        HttpsURLConnection c = request(path, payload, "/v1/models".equals(path) ? 24000 : 6500);
        try (InputStream input = success(c)) {
            return new JSONObject(readText(input));
        } finally { c.disconnect(); }
    }

    private static String readText(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    void stream(String id, JSONObject payload, Consumer<JSONObject> receive) throws Exception {
        HttpsURLConnection c = request(chatPath(id) + "/messages", payload, 245000);
        activeReply = c;
        boolean finished = false;
        try (var reader = new BufferedReader(new InputStreamReader(success(c), StandardCharsets.UTF_8))) {
            for (String line; (line = reader.readLine()) != null;) {
                JSONObject event = new JSONObject(line);
                String type = event.optString("type");
                if (type.equals("done") || type.equals("error")) finished = true;
                receive.accept(event);
            }
            if (!finished) throw new IOException("Connection closed before the reply finished.");
        } finally {
            activeReply = null;
            c.disconnect();
        }
    }

    void stopReply() {
        HttpsURLConnection c = activeReply;
        if (c != null) c.disconnect();
    }
}
