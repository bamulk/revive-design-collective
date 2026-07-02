import AppLoadingIndicator from "@/components/AppLoadingIndicator";

/**
 * App-shell cold-start loading screen. Next renders this while the
 * (app) layout's server components are fetching on a fresh visit
 * (most often when opening the PWA from the home screen). Shares the
 * exact same design as the in-app route-transition overlay so the
 * user never sees two different loaders.
 */
export default function AppLoading() {
  return <AppLoadingIndicator />;
}
