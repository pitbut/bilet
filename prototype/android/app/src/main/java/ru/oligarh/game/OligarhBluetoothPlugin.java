package ru.oligarh.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bluetooth Classic (RFCOMM) для игры за одним столом.
 * Хозяин открывает сервер и становится видимым; гости ищут устройства с именем «Олигарх: …» и подключаются.
 * Сообщения — строки JSON, разделённые переводом строки.
 */
@CapacitorPlugin(
    name = "OligarhBluetooth",
    permissions = {
        @Permission(alias = "bt", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class OligarhBluetoothPlugin extends Plugin {
    private static final UUID SERVICE = UUID.fromString("6f6c6967-6172-6800-8000-00805f9b34fb");
    private static final String PREFIX = "Олигарх: ";
    private static final int MAX_GUESTS = 5;

    private BluetoothAdapter adapter;
    private BluetoothServerSocket server;
    private final Map<String, BluetoothSocket> sockets = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> outputs = new ConcurrentHashMap<>();
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final AtomicInteger peerCounter = new AtomicInteger(1);
    private BroadcastReceiver scanReceiver;
    private String originalName;
    private volatile boolean running;

    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = bm != null ? bm.getAdapter() : null;
    }

    // ---------- Разрешения и включение Bluetooth ----------

    private boolean hasPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return getPermissionState("bt") == PermissionState.GRANTED;
        return getPermissionState("location") == PermissionState.GRANTED;
    }

    /** Проверяет разрешения и что Bluetooth включён; иначе просит пользователя и повторяет вызов. */
    private boolean ready(PluginCall call) {
        if (adapter == null) { call.reject("На этом телефоне нет Bluetooth"); return false; }
        if (!hasPermissions()) {
            requestPermissionForAlias(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bt" : "location", call, "permsDone");
            return false;
        }
        if (!adapter.isEnabled()) {
            startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "enableDone");
            return false;
        }
        return true;
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        if (!hasPermissions()) { call.reject("Без разрешения на Bluetooth игра по сети невозможна"); return; }
        rerun(call);
    }

    @ActivityCallback
    private void enableDone(PluginCall call, ActivityResult result) {
        if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth выключен"); return; }
        rerun(call);
    }

    private void rerun(PluginCall call) {
        switch (call.getMethodName()) {
            case "startServer": startServer(call); break;
            case "scan": scan(call); break;
            case "connect": connect(call); break;
            default: call.resolve();
        }
    }

    // ---------- Хозяин стола ----------

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startServer(PluginCall call) {
        if (!ready(call)) return;
        String name = call.getString("name", "Стол");
        stopAll();
        running = true;
        try {
            originalName = adapter.getName();
            adapter.setName(PREFIX + name); // по имени гости находят стол среди других устройств
            server = adapter.listenUsingInsecureRfcommWithServiceRecord("Oligarh", SERVICE);
        } catch (IOException | SecurityException e) {
            call.reject("Не удалось открыть стол: " + e.getMessage());
            return;
        }
        new Thread(this::acceptLoop, "bt-accept").start();
        Intent visible = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
        visible.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
        startActivityForResult(call, visible, "discoverableDone");
    }

    @ActivityCallback
    private void discoverableDone(PluginCall call, ActivityResult result) {
        call.resolve(); // даже если видимость не дали — уже сопряжённые телефоны смогут подключиться
    }

    private void acceptLoop() {
        while (running && server != null) {
            try {
                BluetoothSocket s = server.accept();
                if (sockets.size() >= MAX_GUESTS) { s.close(); continue; }
                String peer = "p" + peerCounter.getAndIncrement();
                attach(peer, s);
            } catch (IOException e) {
                break; // сервер закрыт
            }
        }
    }

    // ---------- Поиск столов ----------

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void scan(PluginCall call) {
        if (!ready(call)) return;
        stopScanInternal();
        try {
            for (BluetoothDevice d : adapter.getBondedDevices()) report(d);
        } catch (SecurityException ignored) { }
        scanReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) {
                    BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d != null) report(d);
                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(intent.getAction()) && scanReceiver != null) {
                    try { adapter.startDiscovery(); } catch (SecurityException ignored) { } // ищем, пока экран поиска открыт
                }
            }
        };
        IntentFilter f = new IntentFilter(BluetoothDevice.ACTION_FOUND);
        f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        getContext().registerReceiver(scanReceiver, f);
        try { adapter.startDiscovery(); } catch (SecurityException e) { call.reject("Нет разрешения на поиск"); return; }
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void report(BluetoothDevice d) {
        String n;
        try { n = d.getName(); } catch (SecurityException e) { return; }
        if (n == null || !n.startsWith(PREFIX)) return;
        JSObject o = new JSObject();
        o.put("address", d.getAddress());
        o.put("name", n.substring(PREFIX.length()));
        notifyListeners("found", o);
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        stopScanInternal();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void stopScanInternal() {
        if (scanReceiver != null) {
            try { getContext().unregisterReceiver(scanReceiver); } catch (IllegalArgumentException ignored) { }
            scanReceiver = null;
        }
        try { if (adapter != null) adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
    }

    // ---------- Гость ----------

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(PluginCall call) {
        if (!ready(call)) return;
        String address = call.getString("address");
        if (address == null) { call.reject("Нет адреса стола"); return; }
        stopScanInternal();
        running = true;
        new Thread(() -> {
            try {
                BluetoothDevice d = adapter.getRemoteDevice(address);
                BluetoothSocket s = d.createInsecureRfcommSocketToServiceRecord(SERVICE);
                s.connect();
                attach("host", s);
                call.resolve();
            } catch (IOException | SecurityException | IllegalArgumentException e) {
                call.reject("Не удалось подключиться: " + e.getMessage());
            }
        }, "bt-connect").start();
    }

    // ---------- Обмен сообщениями ----------

    private void attach(String peer, BluetoothSocket s) throws IOException {
        sockets.put(peer, s);
        outputs.put(peer, s.getOutputStream());
        JSObject up = new JSObject();
        up.put("peer", peer);
        up.put("up", true);
        notifyListeners("peer", up);
        new Thread(() -> readLoop(peer, s), "bt-read-" + peer).start();
    }

    private void readLoop(String peer, BluetoothSocket s) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null) {
                JSObject o = new JSObject();
                o.put("peer", peer);
                o.put("data", line);
                notifyListeners("data", o);
            }
        } catch (IOException ignored) {
            // соединение оборвалось
        }
        drop(peer);
    }

    private void drop(String peer) {
        BluetoothSocket s = sockets.remove(peer);
        outputs.remove(peer);
        if (s == null) return;
        try { s.close(); } catch (IOException ignored) { }
        JSObject down = new JSObject();
        down.put("peer", peer);
        down.put("up", false);
        notifyListeners("peer", down);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String peer = call.getString("peer");
        String data = call.getString("data");
        OutputStream out = peer != null ? outputs.get(peer) : null;
        if (out == null || data == null) { call.reject("Нет такого участника"); return; }
        byte[] bytes = (data.replace("\n", " ") + "\n").getBytes(StandardCharsets.UTF_8);
        writer.execute(() -> {
            try {
                out.write(bytes);
                out.flush();
            } catch (IOException e) {
                drop(peer);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopAll();
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    private void stopAll() {
        running = false;
        stopScanInternal();
        if (server != null) { try { server.close(); } catch (IOException ignored) { } server = null; }
        for (String p : sockets.keySet()) drop(p);
        if (originalName != null && adapter != null) {
            try { adapter.setName(originalName); } catch (SecurityException ignored) { }
            originalName = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopAll();
        writer.shutdownNow();
    }
}
