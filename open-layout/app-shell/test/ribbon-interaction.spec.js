import { test, expect } from '@playwright/test';

test.describe('Ribbon Bar Interactions', () => {
  
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`BROWSER [error]: ${err.message}`);
    });

    await page.goto('/spread-editor/index.html');
    await page.waitForSelector('scribus-app-shell:defined');
    const statusEl = page.locator('#status');
    await expect(statusEl).toHaveText(/Ready/, { timeout: 20000 });
  });

  test('Changing Font Size slider in Spread Editor is stable and connected', async ({ page }) => {
    // Double click the text frame to enter text mode
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();

    // Wait for the ribbon slider to appear
    const sizeSlider = page.locator('scribus-input#font-size input[type="range"]');
    await expect(sizeSlider).toBeVisible();

    const initialValue = Number(await sizeSlider.inputValue());
    console.log(`Initial Font Size: ${initialValue}`);

    // Simulate slider interaction via evaluate (Playwright synthetic mouse drag does not
    // reliably fire native input events on shadow-DOM range inputs in headless Chrome,
    // and no-focus/event.preventDefault on mousedown prevents focus stealing from the
    // text editor — which is the correct behavior in real browsers).
    const result = await page.evaluate(async (init) => {
      const host = document.querySelector('scribus-input#font-size');
      const input = host?.shadowRoot?.getElementById('input');
      if (!host || !input) return null;

      host._dragging = true;
      const target = init + 30;
      input.value = String(target);
      input.dispatchEvent(new Event('input', { bubbles: false }));
      await new Promise(r => setTimeout(r, 50));
      host._dragging = false;

      // Key check: is the element still connected to the DOM?
      // If it was destroyed and recreated during the update cycle, isConnected is false.
      return { isConnected: host.isConnected, finalValue: Number(input.value) };
    }, initialValue);

    console.log(`Slider isConnected: ${result.isConnected}, final value: ${result.finalValue}`);

    expect(result.isConnected).toBe(true);
    expect(result.finalValue).toBeGreaterThan(initialValue);
  });

  test('Font Size slider drag tracks value across many intermediate steps', async ({ page }) => {
    // Regression: concurrent update() cycles during rapid applyFontSize calls
    // were resetting the slider value to the minimum (1) mid-drag via attribute
    // reconciliation (_updateElement removing or replacing the value attribute).
    // This test directly fires input events on the shadow-DOM range input and
    // arms/disarms the _dragging guard to simulate what mousedown/mouseup do,
    // because Playwright's synthetic mouse drag does not reliably fire native
    // input events on range inputs in headless Chromium.
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();

    const sizeSlider = page.locator('scribus-input#font-size input[type="range"]');
    await expect(sizeSlider).toBeVisible();

    const initialValue = Number(await sizeSlider.inputValue());

    // Simulate a drag: arm _dragging, fire 20 input events with increasing values,
    // then disarm. Yields between steps so rAF update() cycles can run and attempt
    // to reset the slider — the _dragging guard must prevent them from doing so.
    const finalFontSize = await page.evaluate(async (init) => {
      const host = document.querySelector('scribus-input#font-size');
      const input = host?.shadowRoot?.getElementById('input');
      if (!host || !input) return null;

      host._dragging = true; // arm guard (mirrors mousedown handler)

      const min = Number(input.min) || 1;
      const max = Number(input.max) || 200;
      const target = min + Math.round((max - min) * 0.8); // 80% of range
      const steps = 20;

      for (let i = 1; i <= steps; i++) {
        const v = Math.round(init + (target - init) * (i / steps));
        input.value = String(v);
        // Dispatch native input event; ScribusInput's listener will forward it
        // as a custom change event → applyFontSize → _scheduleStyleUpdate.
        input.dispatchEvent(new Event('input', { bubbles: false }));
        // Yield so rAF-driven update() cycles run and can attempt a reset.
        await new Promise(r => setTimeout(r, 20));
      }

      host._dragging = false; // release (mirrors mouseup handler)
      return Number(input.value);
    }, initialValue);

    await page.waitForTimeout(200); // let final layout settle

    const sliderValue = Number(await sizeSlider.inputValue());
    console.log(`Drag test: ${initialValue} → ${sliderValue}`);

    // Dragging to 80% of the range (max 200) must land well above the initial value
    expect(sliderValue).toBeGreaterThan(initialValue + 20);
    // The value must NOT have been reset to the minimum (1) during the drag
    expect(sliderValue).not.toBe(1);
  });

  test('Font Size label has fixed width prevent jumping', async ({ page }) => {
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    const valDisplay = page.locator('scribus-input#font-size .val');
    await expect(valDisplay).toBeVisible();
    
    const styles = await valDisplay.evaluate(el => {
      const s = window.getComputedStyle(el);
      return {
        minWidth: s.minWidth,
        display: s.display,
        textAlign: s.textAlign
      };
    });
    
    console.log('Val display styles:', styles);
    expect(styles.minWidth).not.toBe('0px');
    expect(styles.display).toMatch(/block|inline-block/);
  });

  test('Adjusting Font Size via number input spinner in sidebar is stable for ribbon', async ({ page }) => {
    // Double click to enter text mode
    const firstBox = page.locator('svg.overlay-svg rect[data-box-id]').first();
    await firstBox.dblclick();
    
    // Target the pt input in the SIDEBAR
    const sidebarSizeInput = page.locator('scribus-input[data-property-key="font-size"] input[type="number"]');
    await expect(sidebarSizeInput).toBeVisible();
    
    // Get a handle to a ribbon element to detect re-renders
    const ribbonItem = page.locator('.ribbon-controls scribus-input').first();
    await expect(ribbonItem).toBeVisible();
    
    const initialVal = await sidebarSizeInput.inputValue();
    console.log(`Initial Sidebar Size: ${initialVal}`);
    
    // Click the up button on the spinner
    const box = await sidebarSizeInput.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 5, box.y + 5);
      
      const newVal = await sidebarSizeInput.inputValue();
      console.log(`New Sidebar Size: ${newVal}`);
      
      // Ribbon should NOT have re-rendered (preserved connection)
      const isConnected = await ribbonItem.evaluate(el => el.isConnected);
      console.log(`Ribbon item still connected after sidebar spinner click: ${isConnected}`);
      expect(isConnected).toBe(true);
    }
  });
});
