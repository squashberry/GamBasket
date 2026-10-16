/* GamBasket category-aware product attributes. */
(() => {
  "use strict";

  const fallback = {
    Phones: [
      ["brand", "Brand", "text"], ["model", "Model", "text", true],
      ["storage", "Storage", "select", false, ["32GB","64GB","128GB","256GB","512GB","1TB"]],
      ["colour", "Colour", "text"], ["battery_health", "Battery health (%)", "number"],
      ["network_locked", "Network locked?", "select", false, ["No","Yes","Unknown"]]
    ],
    Electronics: [
      ["brand","Brand","text"],["model","Model","text"],["processor","Processor / chipset","text"],
      ["ram","RAM","select",false,["2GB","4GB","8GB","16GB","32GB","64GB"]],
      ["storage","Storage","select",false,["64GB","128GB","256GB","512GB","1TB","2TB"]],
      ["warranty","Warranty","select",false,["None","Seller warranty","Manufacturer warranty"]]
    ],
    Fashion: [["brand","Brand","text"],["size","Size","text"],["colour","Colour","text"],["material","Material","text"]],
    Food: [["pack_size","Pack size / quantity","text"],["expiry_date","Expiry date","date"],["origin","Origin","text"]],
    Home: [["material","Material","text"],["dimensions","Dimensions","text"],["assembly_required","Assembly required?","select",false,["No","Yes"]]],
    Beauty: [["size","Size / volume","text"],["sealed","Factory sealed?","select",false,["Yes","No"]],["expiry_date","Expiry date","date"]],
    Solar: [["power_watts","Power (watts)","number"],["voltage","Voltage","text"],["warranty_months","Warranty (months)","number"]],
    Auto: [["make","Make","text"],["model","Model","text"],["year","Year","number"],["mileage_km","Mileage (km)","number"],["transmission","Transmission","select",false,["Automatic","Manual","Other"]],["fuel_type","Fuel type","select",false,["Petrol","Diesel","Hybrid","Electric","Other"]]],
    Hardware: [["brand","Brand","text"],["power_rating","Power / capacity","text"],["warranty_months","Warranty (months)","number"]],
    Baby: [["age_range","Recommended age","text"],["material","Material","text"]],
    Sports: [["sport_type","Sport / activity","text"],["size","Size","text"],["brand","Brand","text"]]
  };

  const categoryAliases = { Groceries: "Food", Vehicles: "Auto", Tools: "Hardware", "Phones & Tablets": "Phones", "Electronics & Laptops": "Electronics" };
  const canonicalCategory = value => categoryAliases[String(value || "")] || String(value || "Phones");

  function fallbackDefinitions(category) {
    return (fallback[canonicalCategory(category)] || []).map((item, index) => ({
      attribute_key: item[0], label: item[1], input_type: item[2],
      is_required: Boolean(item[3] === true),
      options: item[4] || [], sort_order: (index + 1) * 10
    }));
  }

  async function loadDefinitions(category) {
    const name = canonicalCategory(category);
    try {
      const client = window.GamBasketAuth?.getClient?.() || window.supabaseClient;
      if (client) {
        const { data, error } = await client.from("category_attribute_definitions")
          .select("attribute_key,label,input_type,options,is_required,sort_order")
          .eq("category_id", name).eq("is_active", true).order("sort_order");
        if (!error && Array.isArray(data) && data.length) return data;
      }
    } catch (error) {
      console.warn("[GamBasket attributes] Using local field definitions:", error?.message);
    }
    return fallbackDefinitions(name);
  }

  async function render(container, category, values = {}) {
    if (!container) return [];
    const generation = (Number(container.dataset.renderGeneration) || 0) + 1;
    container.dataset.renderGeneration = String(generation);
    container.replaceChildren();
    const definitions = await loadDefinitions(category);
    if (container.dataset.renderGeneration !== String(generation)) return definitions;

    if (!definitions.length) {
      const note = document.createElement("p");
      note.className = "product-attributes-empty";
      note.textContent = "No extra details are required for this category.";
      container.append(note);
      return definitions;
    }

    const heading = document.createElement("div");
    heading.className = "product-attributes-heading";
    const title = document.createElement("strong");
    title.textContent = "Product details";
    const hint = document.createElement("span");
    hint.textContent = "Help buyers compare similar items";
    heading.append(title, hint);
    container.append(heading);

    const grid = document.createElement("div");
    grid.className = "product-attributes-grid";
    for (const def of definitions) {
      const key = String(def.attribute_key || "");
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
      const label = document.createElement("label");
      label.className = "product-attribute-field";
      label.htmlFor = `productAttribute_${key}`;
      const caption = document.createElement("span");
      caption.textContent = `${def.label || key.replaceAll("_", " ")}${def.is_required ? " *" : ""}`;
      let input;
      if (def.input_type === "select") {
        input = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = ""; blank.textContent = "Select…"; input.append(blank);
        (Array.isArray(def.options) ? def.options : []).forEach(option => {
          const opt = document.createElement("option");
          opt.value = String(option); opt.textContent = String(option);
          input.append(opt);
        });
      } else {
        input = document.createElement("input");
        input.type = ["text","number","date"].includes(def.input_type) ? def.input_type : "text";
        if (input.type === "number") { input.min = "0"; input.step = "any"; }
      }
      input.id = `productAttribute_${key}`;
      input.name = key;
      input.dataset.attributeKey = key;
      input.required = Boolean(def.is_required);
      input.maxLength = input.type === "text" ? 120 : input.maxLength;
      input.value = values[key] === undefined || values[key] === null ? "" : String(values[key]);
      label.append(caption, input);
      grid.append(label);
    }
    container.append(grid);
    return definitions;
  }

  function read(container) {
    if (!container) return {};
    const values = {};
    for (const input of container.querySelectorAll("[data-attribute-key]")) {
      const key = input.dataset.attributeKey;
      if (!key || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
      if (input.required && !String(input.value || "").trim()) {
        input.reportValidity?.();
        throw new Error(`Please complete ${input.labels?.[0]?.innerText?.replace("*","").trim() || key}.`);
      }
      if (input.type === "checkbox") values[key] = Boolean(input.checked);
      else if (input.type === "number") {
        if (input.value.trim() !== "") {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value < 0) throw new Error(`Enter a valid value for ${key.replaceAll("_"," ")}.`);
          values[key] = value;
        }
      } else if (String(input.value || "").trim()) {
        values[key] = String(input.value).trim().slice(0, 120);
      }
    }
    if (Object.keys(values).length > 16) throw new Error("Please use no more than 16 product attributes.");
    if (JSON.stringify(values).length > 4000) throw new Error("Product details are too long.");
    return values;
  }

  function renderDisplay(container, attributes = {}) {
    if (!container) return;
    container.replaceChildren();
    const entries = Object.entries(attributes || {}).filter(([key, value]) =>
      /^[a-z][a-z0-9_]{0,39}$/.test(key) && value !== "" && value !== null && value !== undefined
    ).slice(0, 16);
    if (!entries.length) { container.hidden = true; return; }
    container.hidden = false;
    const list = document.createElement("dl");
    list.className = "product-attributes-readonly";
    for (const [key, value] of entries) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = key.replaceAll("_", " ").replace(/\b\w/g, ch => ch.toUpperCase());
      const description = document.createElement("dd");
      description.textContent = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).slice(0, 200);
      row.append(term, description); list.append(row);
    }
    container.append(list);
  }

  window.GamBasketProductAttributes = { canonicalCategory, render, read, renderDisplay, fallbackDefinitions };
})();
