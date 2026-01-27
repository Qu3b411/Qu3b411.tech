// Blog helper module: populate posts dropdown from bundle
export function populatePostsDropdown(dropdownEl, posts) {
  // Clear existing except first placeholder
  while (dropdownEl.options.length > 1) {
    dropdownEl.remove(1);
  }
  posts
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .forEach((post) => {
      const opt = document.createElement('option');
      opt.value = post.id;
      opt.textContent = post.title;
      dropdownEl.appendChild(opt);
    });
}