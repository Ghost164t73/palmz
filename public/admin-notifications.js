(() => {
  const badge = document.querySelector(".orders-notification");
  if (!badge) return;

  async function refreshPendingOrders() {
    try {
      const response = await fetch("/api/admin/orders?status=pending_confirmation", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const { orders = [] } = await response.json();
      const count = orders.length;
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.setAttribute("aria-label", `${count} pending order${count === 1 ? "" : "s"}`);
      badge.title = `${count} pending order${count === 1 ? "" : "s"}`;
    } catch {
      // Keep the current indicator state if the admin API is temporarily unavailable.
    }
  }

  refreshPendingOrders();
  window.setInterval(refreshPendingOrders, 60000);
})();
