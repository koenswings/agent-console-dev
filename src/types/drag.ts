/** Payload carried during an app drag operation. */
export interface DragAppData {
  instanceId:     string;
  instanceName:   string;
  sourceDiskId:   string;
  sourceDiskName: string;
}

export const DRAG_TYPE = 'application/x-idea-instance';
