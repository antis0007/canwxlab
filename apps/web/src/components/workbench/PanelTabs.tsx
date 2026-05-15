export interface PanelTab {
  id: string;
  label: string;
}

interface PanelTabsProps {
  tabs: PanelTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function PanelTabs({ tabs, activeTab, onChange }: PanelTabsProps) {
  return (
    <div className="wb-panel-tabs" role="tablist" aria-label="Workbench sidebar tabs">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={tab.id === activeTab ? "wb-tab wb-tab-active" : "wb-tab"}
          onClick={() => onChange(tab.id)}
          role="tab"
          aria-selected={tab.id === activeTab}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
