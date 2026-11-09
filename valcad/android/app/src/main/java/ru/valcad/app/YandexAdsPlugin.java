package ru.valcad.app;

import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yandex.mobile.ads.banner.BannerAdEventListener;
import com.yandex.mobile.ads.banner.BannerAdSize;
import com.yandex.mobile.ads.banner.BannerAdView;
import com.yandex.mobile.ads.common.AdError;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.interstitial.InterstitialAd;
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader;

/** Реклама Яндекса (Yandex Mobile Ads SDK, «Простая монетизация»): липкий баннер внизу и межстраничная реклама. */
@CapacitorPlugin(name = "YandexAds")
public class YandexAdsPlugin extends Plugin {
    private boolean initialized = false;
    private BannerAdView banner;
    private FrameLayout bannerHolder;
    private int navInset = 0;
    private InterstitialAdLoader interstitialLoader;
    private InterstitialAd interstitial;
    private String interstitialId;

    @PluginMethod
    public void init(PluginCall call) {
        if (initialized) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> {
            YandexAds.initialize(getContext(), () -> {
                initialized = true;
                call.resolve();
            });
        });
    }

    @PluginMethod
    public void showBanner(PluginCall call) {
        String id = call.getString("adUnitId");
        if (id == null || id.isEmpty()) { call.reject("adUnitId required"); return; }
        getActivity().runOnUiThread(() -> {
            try {
                if (banner == null) {
                    ViewGroup root = getActivity().findViewById(android.R.id.content);
                    bannerHolder = new FrameLayout(getContext());
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
                    root.addView(bannerHolder, lp);
                    // поднимаем баннер над системной панелью навигации (edge-to-edge)
                    ViewCompat.setOnApplyWindowInsetsListener(bannerHolder, (v, insets) -> {
                        Insets nb = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                        navInset = nb.bottom;
                        v.setPadding(0, 0, 0, navInset);
                        notifyHeight();
                        return insets;
                    });
                    ViewCompat.requestApplyInsets(bannerHolder);
                    banner = new BannerAdView(getContext());
                    DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
                    int widthDp = Math.round(dm.widthPixels / dm.density);
                    banner.setAdSize(BannerAdSize.sticky(getContext(), widthDp));
                    banner.setBannerAdEventListener(new BannerAdEventListener() {
                        @Override public void onAdLoaded() { bannerHolder.setVisibility(View.VISIBLE); notifyHeight(); }
                        @Override public void onAdFailedToLoad(AdRequestError error) {
                            JSObject o = new JSObject(); o.put("error", error.getDescription());
                            notifyListeners("bannerFailed", o);
                        }
                        @Override public void onAdClicked() { }
                        @Override public void onImpression(ImpressionData data) { }
                    });
                    bannerHolder.addView(banner, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL));
                }
                bannerHolder.setVisibility(View.VISIBLE);
                banner.loadAd(new AdRequest.Builder(id).build());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    private void notifyHeight() {
        if (bannerHolder == null || banner == null) return;
        bannerHolder.post(() -> {
            float d = getContext().getResources().getDisplayMetrics().density;
            int h = bannerHolder.getVisibility() == View.VISIBLE ? bannerHolder.getHeight() : 0;
            JSObject o = new JSObject();
            o.put("height", Math.round(h / d));
            notifyListeners("bannerHeight", o);
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (bannerHolder != null) bannerHolder.setVisibility(View.GONE);
            JSObject o = new JSObject(); o.put("height", 0);
            notifyListeners("bannerHeight", o);
            call.resolve();
        });
    }

    @PluginMethod
    public void loadInterstitial(PluginCall call) {
        String id = call.getString("adUnitId");
        if (id == null || id.isEmpty()) { call.reject("adUnitId required"); return; }
        interstitialId = id;
        getActivity().runOnUiThread(() -> {
            if (interstitialLoader == null) interstitialLoader = new InterstitialAdLoader(getContext());
            interstitialLoader.loadAd(new AdRequest.Builder(id).build(), new InterstitialAdLoadListener() {
                @Override public void onAdLoaded(InterstitialAd ad) { interstitial = ad; }
                @Override public void onAdFailedToLoad(AdRequestError error) { interstitial = null; }
            });
            call.resolve();
        });
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (interstitial == null) {
                JSObject o = new JSObject(); o.put("shown", false); call.resolve(o);
                return;
            }
            InterstitialAd ad = interstitial;
            interstitial = null;
            ad.setAdEventListener(new InterstitialAdEventListener() {
                @Override public void onAdShown() { }
                @Override public void onAdFailedToShow(AdError error) { reload(); }
                @Override public void onAdDismissed() { reload(); }
                @Override public void onAdClicked() { }
                @Override public void onAdImpression(ImpressionData data) { }
            });
            ad.show(getActivity());
            JSObject o = new JSObject(); o.put("shown", true); call.resolve(o);
        });
    }

    private void reload() {
        if (interstitialId == null || interstitialLoader == null) return;
        getActivity().runOnUiThread(() -> interstitialLoader.loadAd(new AdRequest.Builder(interstitialId).build(), new InterstitialAdLoadListener() {
            @Override public void onAdLoaded(InterstitialAd ad) { interstitial = ad; }
            @Override public void onAdFailedToLoad(AdRequestError error) { interstitial = null; }
        }));
    }

    @Override
    protected void handleOnDestroy() {
        if (banner != null) banner.destroy();
        super.handleOnDestroy();
    }
}
