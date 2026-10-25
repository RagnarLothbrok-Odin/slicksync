import dynamic from "next/dynamic";

export * from "./Avatar";
export * from "./Badge";
export * from "./Button";
export * from "./Card";
export * from "./ColorPicker";
export * from "./CommandPalette";
export * from "./DateTimePicker";
export * from "./InlineEdit";
export * from "./Modal";
export * from "./SlickSyncLogo";
export * from "./SyncBadge";
export * from "./ToggleSwitch";
export * from "./UserAvatar";
// The title popup is ~1,900 lines that open on a click. Loading it after
// first paint instead of with it takes a real chunk out of every page's
// first load - it is by far the largest single thing in the shared bundle.
export const MediaDetailModal = dynamic(
    () => import("./MediaDetailModal").then((m) => m.MediaDetailModal),
    { ssr: false }
);
export * from "./BeginnerHint";
export * from "./ComboBox";
export * from "./ContextMenu";
export * from "./DragSortable";
export * from "./DropdownSelect";
export * from "./FilterTabs";
export * from "./Input";
export * from "./ListPosterThumb";
export * from "./PageToolbar";
export * from "./PosterCard";
export * from "./ProviderKeyHealthBadge";
export * from "./RatingBadges";
export * from "./SelectAllCheckbox";
export * from "./SelectionCheckbox";
export * from "./Skeleton";
export * from "./SyncPreviewDialog";
export * from "./Toast";
export * from "./ViewModeToggle";
export * from "./VirtualPosterGrid";
export * from "./YearInReviewCard";
