// Simple HTML sanitizer. Removes script tags, event handlers and javascript: URIs.
export function sanitizeHtml(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  // Remove all <script> elements
  doc.querySelectorAll('script').forEach((el) => el.remove());

  // Remove event handler attributes (on*)
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
      // Remove javascript: from href or src
      if (['href', 'src', 'data', 'xlink:href'].includes(attr.name)) {
        const val = attr.value.trim();
        if (/^javascript:/i.test(val)) {
          el.removeAttribute(attr.name);
        }
      }
    });
  });

  // Return sanitized innerHTML of body
  return doc.body.innerHTML;
}