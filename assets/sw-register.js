{{- $swJS := resources.Get "sw.js" | resources.ExecuteAsTemplate "sw.js" . -}}
if (navigator.serviceWorker) {
  var swUrl = "{{ $swJS.RelPermalink }}";
  var scope = swUrl.substring(0, swUrl.lastIndexOf('/') + 1);
  navigator.serviceWorker.register(swUrl, { scope: scope });
}
