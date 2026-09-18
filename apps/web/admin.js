const nav = [...document.querySelectorAll(".admin-nav button")];
const panels = [...document.querySelectorAll(".admin-section")];
const title = document.querySelector("#section-title");
function show(section) {
  nav.forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === section));
  const active = nav.find((button) => button.dataset.section === section);
  if (active && title) title.textContent = active.textContent;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
nav.forEach((button) => button.addEventListener("click", () => show(button.dataset.section)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => show(button.dataset.go)));
