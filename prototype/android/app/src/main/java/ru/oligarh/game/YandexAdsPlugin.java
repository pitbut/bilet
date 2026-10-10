package ru.oligarh.game;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yandex.mobile.ads.common.AdError;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.interstitial.InterstitialAd;
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader;
import com.yandex.mobile.ads.rewarded.Reward;
import com.yandex.mobile.ads.rewarded.RewardedAd;
import com.yandex.mobile.ads.rewarded.RewardedAdEventListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoadListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoader;

/**
 * Рекламная сеть Яндекса: реклама за награду и межстраничная.
 * JS заранее вызывает load*, а show* показывает загруженное объявление.
 */
@CapacitorPlugin(name = "YandexAds")
public class YandexAdsPlugin extends Plugin {
    private RewardedAdLoader rewardedLoader;
    private InterstitialAdLoader interstitialLoader;
    private RewardedAd rewarded;
    private InterstitialAd interstitial;
    private String rewardedId;
    private String interstitialId;

    @PluginMethod
    public void init(PluginCall call) {
        rewardedId = call.getString("rewardedId");
        interstitialId = call.getString("interstitialId");
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            YandexAds.setLocationTracking(false); // местоположение в рекламу не передаём
            YandexAds.initialize(act, () -> { });
            rewardedLoader = new RewardedAdLoader(act);
            interstitialLoader = new InterstitialAdLoader(act);
            loadRewardedInternal();
            loadInterstitialInternal();
            call.resolve();
        });
    }

    private static JSObject kind(String k) { JSObject o = new JSObject(); o.put("kind", k); return o; }

    private void loadRewardedInternal() {
        if (rewardedLoader == null || rewardedId == null) return;
        rewardedLoader.loadAd(new AdRequest.Builder(rewardedId).build(), new RewardedAdLoadListener() {
            @Override public void onAdLoaded(RewardedAd ad) { rewarded = ad; notifyListeners("loaded", kind("rewarded")); }
            @Override public void onAdFailedToLoad(AdRequestError error) { rewarded = null; notifyListeners("failed", kind("rewarded")); }
        });
    }

    private void loadInterstitialInternal() {
        if (interstitialLoader == null || interstitialId == null) return;
        interstitialLoader.loadAd(new AdRequest.Builder(interstitialId).build(), new InterstitialAdLoadListener() {
            @Override public void onAdLoaded(InterstitialAd ad) { interstitial = ad; notifyListeners("loaded", kind("interstitial")); }
            @Override public void onAdFailedToLoad(AdRequestError error) { interstitial = null; notifyListeners("failed", kind("interstitial")); }
        });
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject o = new JSObject();
        o.put("rewarded", rewarded != null);
        o.put("interstitial", interstitial != null);
        call.resolve(o);
    }

    /** Показать рекламу за награду. Ответ: { rewarded: true }, если досмотрели. */
    @PluginMethod
    public void showRewarded(PluginCall call) {
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            RewardedAd ad = rewarded;
            if (ad == null) { loadRewardedInternal(); call.reject("Реклама ещё не загрузилась"); return; }
            rewarded = null;
            final boolean[] got = { false };
            ad.setAdEventListener(new RewardedAdEventListener() {
                @Override public void onAdShown() { }
                @Override public void onAdFailedToShow(AdError adError) { finish(call, false); loadRewardedInternal(); }
                @Override public void onAdDismissed() { finish(call, got[0]); ad.setAdEventListener(null); loadRewardedInternal(); }
                @Override public void onAdClicked() { }
                @Override public void onAdImpression(ImpressionData impressionData) { }
                @Override public void onRewarded(Reward reward) { got[0] = true; }
            });
            ad.show(act);
        });
    }

    private void finish(PluginCall call, boolean rewardedFlag) {
        JSObject o = new JSObject();
        o.put("rewarded", rewardedFlag);
        call.resolve(o);
    }

    /** Межстраничная реклама (между партиями). */
    @PluginMethod
    public void showInterstitial(PluginCall call) {
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            InterstitialAd ad = interstitial;
            if (ad == null) { loadInterstitialInternal(); call.resolve(); return; }
            interstitial = null;
            ad.setAdEventListener(new InterstitialAdEventListener() {
                @Override public void onAdShown() { }
                @Override public void onAdFailedToShow(AdError adError) { call.resolve(); loadInterstitialInternal(); }
                @Override public void onAdDismissed() { call.resolve(); ad.setAdEventListener(null); loadInterstitialInternal(); }
                @Override public void onAdClicked() { }
                @Override public void onAdImpression(ImpressionData impressionData) { }
            });
            ad.show(act);
        });
    }
}
