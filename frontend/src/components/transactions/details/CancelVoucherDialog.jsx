import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CancelVoucherDialog({
  label = "Cancel",
  title = "Cancel voucher?",
  description,
  confirmLabel = "Yes, cancel",
  warning,
  disabled = false,
  isCancelled = false,
  hideWhenCancelled = true,
  isLoading = false,
  onConfirm,
  triggerClassName,
  triggerIcon: TriggerIcon,
  triggerSize = "sm",
  triggerVariant = "destructive",
}) {
  const [open, setOpen] = useState(false);

  const handleConfirm = async () => {
    if (!onConfirm) return;
    await onConfirm();
    setOpen(false);
  };

  if (isCancelled && hideWhenCancelled) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        size={triggerSize}
        variant={triggerVariant}
        className={triggerClassName || "bg-rose-600 text-white hover:bg-rose-700"}
        disabled={disabled || isLoading}
        onClick={() => setOpen(true)}
      >
        {TriggerIcon ? <TriggerIcon aria-hidden="true" /> : null}
        {isLoading ? "Cancelling..." : label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={!isLoading}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {description ||
                "This action marks the voucher as cancelled. It can be reverted later if needed."}
            </DialogDescription>
          </DialogHeader>

          {warning ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{warning}</span>
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() => setOpen(false)}
            >
              Keep Active
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={isLoading}
              onClick={handleConfirm}
            >
              {isLoading ? "Cancelling..." : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
