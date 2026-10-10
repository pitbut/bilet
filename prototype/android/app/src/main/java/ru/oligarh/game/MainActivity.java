package ru.oligarh.game;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OligarhBluetoothPlugin.class);
        registerPlugin(YandexAdsPlugin.class);
        super.onCreate(savedInstanceState);
        // во время партии экран не гаснет
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
