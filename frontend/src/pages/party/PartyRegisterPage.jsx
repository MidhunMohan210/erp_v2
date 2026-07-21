import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";

import { countries, INDIA_STATES } from "../../constants/countries";
import { partyService } from "@/api/services/party.service";
import { useAccountGroupListQuery } from "@/hooks/queries/accountGroupQueries";
import { useSubGroupListQuery } from "@/hooks/queries/subGroupQueries";
import {
  partyQueryKeys,
  usePartyByIdQuery,
} from "@/hooks/queries/partyQueries";
import { ROUTES } from "@/routes/paths";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const optionalBalanceType = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["dr", "cr"]).optional(),
);

const schema = z.object({
  partyName: z.string().min(1, "Party name is required"),
  partyType: z.enum(["party", "bank", "cash"]).optional(),
  accountGroup: z.string().min(1, "Account group is required"),
  subGroup: optionalString,
  mobileNumber: z.string().min(1, "Mobile number is required"),
  emailID: z.string().email("Invalid email").optional().or(z.literal("")),
  gstNo: optionalString,
  panNo: optionalString,
  billingAddress: optionalString,
  shippingAddress: optionalString,
  creditPeriod: optionalString,
  creditLimit: optionalString,
  openingBalanceType: optionalBalanceType,
  openingBalanceAmount: optionalString,
  country: optionalString,
  state: optionalString,
  pin: optionalString,
});

const inputClass =
  "h-10 w-full rounded-sm border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300";
const textAreaClass =
  "min-h-24 w-full rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";
const errorClass = "mt-1 text-xs text-rose-500";

export default function PartyRegisterPage() {
  const [searchParams] = useSearchParams();
  const partyId = searchParams.get("partyId");
  const isEdit = Boolean(partyId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cmp_id = useSelector((state) => state.company.selectedCompanyId) || "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    control,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      partyName: "",
      partyType: "party",
      accountGroup: "",
      subGroup: "",
      mobileNumber: "",
      emailID: "",
      gstNo: "",
      panNo: "",
      billingAddress: "",
      shippingAddress: "",
      creditPeriod: "",
      creditLimit: "",
      openingBalanceType: "dr",   // hidden default
      openingBalanceAmount: "0",  // hidden default
      country: "India",
      state: "Kerala",
      pin: "",
    },
  });

  const watchedAccountGroup = useWatch({ control, name: "accountGroup" });
  const selectedCountry = useWatch({ control, name: "country" });

  const {
    data: accountGroups = [],
    isError: isAccountGroupsError,
    error: accountGroupsError,
  } = useAccountGroupListQuery(cmp_id, Boolean(cmp_id));
  const {
    data: subGroups = [],
    isError: isSubGroupsError,
    error: subGroupsError,
  } = useSubGroupListQuery(cmp_id, watchedAccountGroup, Boolean(cmp_id));

  const {
    data: party,
    isLoading: loadingParty,
    isError,
    error,
  } = usePartyByIdQuery(partyId, isEdit);

  const isIndia = selectedCountry === "India";
  const isReadOnly = isEdit && Boolean(party) && party.source !== "web";

  useEffect(() => {
    if (!isAccountGroupsError) return;
    const message =
      accountGroupsError?.response?.data?.message ||
      accountGroupsError?.message ||
      "Failed to load account groups";
    toast.error(message);
  }, [accountGroupsError, isAccountGroupsError]);

  useEffect(() => {
    if (!isSubGroupsError) return;
    const message =
      subGroupsError?.response?.data?.message ||
      subGroupsError?.message ||
      "Failed to load sub groups";
    toast.error(message);
  }, [isSubGroupsError, subGroupsError]);

  useEffect(() => {
    if (!isError) return;
    const message =
      error?.response?.data?.message ||
      error?.message ||
      "Failed to load party";
    toast.error(message);
  }, [error, isError]);

  useEffect(() => {
    if (!party) return;
    if (!accountGroups.length) return;
    reset({
      partyName: party.partyName || "",
      partyType: party.partyType || "party",
      accountGroup:
        party.accountGroup?._id ||
        party.accountGroup?.id ||
        party.accountGroup ||
        "",
      subGroup:
        party.subGroup?._id || party.subGroup?.id || party.subGroup || "",
      mobileNumber: party.mobileNumber || "",
      emailID: party.emailID || "",
      gstNo: party.gstNo || "",
      panNo: party.panNo || "",
      billingAddress: party.billingAddress || "",
      shippingAddress: party.shippingAddress || "",
      creditPeriod: party.creditPeriod || "",
      creditLimit: party.creditLimit || "",
      openingBalanceType: "dr",   // always reset to dr
      openingBalanceAmount: "0",  // always reset to 0
      country: party.country || "",
      state: party.state || "",
      pin: party.pin || "",
    });
  }, [party, accountGroups, reset]);

  const selectedAccountGroupLabel = useMemo(() => {
    return (
      accountGroups.find((item) => item._id === watchedAccountGroup)
        ?.accountGroup || ""
    );
  }, [accountGroups, watchedAccountGroup]);

  const onSubmit = async (values) => {
    if (isReadOnly) return;

    if (!cmp_id) {
      toast.error("Select a company first");
      return;
    }

    try {
      const payload = {
        ...values,
        cmp_id: cmp_id,
        partyName: values.partyName.trim(),
        mobileNumber: values.mobileNumber.trim(),
        emailID: values.emailID?.trim() || "",
        gstNo: values.gstNo?.trim() || "",
        panNo: values.panNo?.trim() || "",
        billingAddress: values.billingAddress?.trim() || "",
        shippingAddress: values.shippingAddress?.trim() || "",
        creditPeriod: values.creditPeriod?.trim() || "",
        creditLimit: values.creditLimit?.trim() || "",
        country: values.country?.trim() || "",
        state: values.state?.trim() || "",
        pin: values.pin?.trim() || "",
        // ✅ Always submit as dr / 0 — not collected from UI
        openingBalanceType: "dr",
        openingBalanceAmount: 0,
        subGroup: values.subGroup || "",
      };

      if (isEdit) {
        const res = await partyService.updateParty(partyId, payload);
        toast.success(res?.message || "Party updated");
      } else {
        const res = await partyService.createParty(payload);
        toast.success(res?.message || "Party added");
      }

      await queryClient.invalidateQueries({ queryKey: partyQueryKeys.all });
      if (partyId) {
        queryClient.removeQueries({
          queryKey: partyQueryKeys.detail(partyId),
          exact: true,
        });
      }

      navigate(ROUTES.mastersPartyList, { replace: true });
    } catch (err) {
      const message =
        err?.response?.data?.message || err?.message || "Save failed";
      toast.error(message);
    }
  };

  return (
    <div className="w-full font-[sans-serif]">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-sm bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 md:text-lg">
                {isEdit ? "Edit Party" : "Create Party"}
              </h2>
              <p className="text-xs text-slate-500 md:text-sm">
                {isEdit
                  ? "Update your customer or party details"
                  : "Fill the details to create a new customer or party"}
              </p>
            </div>
          </div>

          {!cmp_id ? (
            <div className="rounded-sm border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Select a company first to create a party.
            </div>
          ) : loadingParty && isEdit ? (
            <p className="text-sm text-slate-500">Loading party...</p>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit, () => {
                toast.error("Please fix the highlighted fields");
              })}
              className="space-y-5"
            >
              {isReadOnly && (
                <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Parties not created from the web cannot be edited.
                </div>
              )}

              <fieldset disabled={isReadOnly} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>
                    Party Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter party name"
                    {...register("partyName")}
                  />
                  {errors.partyName && (
                    <p className={errorClass}>{errors.partyName.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Party Type</label>
                  <select className={inputClass} {...register("partyType")}>
                    <option value="party">Party</option>
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>
                    Mobile Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter mobile number"
                    {...register("mobileNumber")}
                  />
                  {errors.mobileNumber && (
                    <p className={errorClass}>{errors.mobileNumber.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    Account Group <span className="text-rose-500">*</span>
                  </label>
                  <select className={inputClass} {...register("accountGroup")}>
                    <option value="" disabled>
                      Select account group
                    </option>
                    {accountGroups.map((group) => (
                      <option key={group._id} value={group._id}>
                        {group.accountGroup}
                      </option>
                    ))}
                  </select>
                  {errors.accountGroup && (
                    <p className={errorClass}>{errors.accountGroup.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Sub Group</label>
                  <select className={inputClass} {...register("subGroup")}>
                    <option value="">
                      {watchedAccountGroup
                        ? "Select sub group"
                        : "Choose account group first"}
                    </option>
                    {subGroups.map((group) => (
                      <option key={group._id} value={group._id}>
                        {group.subGroup}
                      </option>
                    ))}
                  </select>
                  {selectedAccountGroupLabel && (
                    <p className="mt-1 text-xs text-slate-400">
                      Selected account group: {selectedAccountGroupLabel}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Email</label>
                  <input
                    type="email"
                    className={inputClass}
                    placeholder="name@example.com"
                    {...register("emailID")}
                  />
                  {errors.emailID && (
                    <p className={errorClass}>{errors.emailID.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>GST Number</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter GST number"
                    {...register("gstNo")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>PAN Number</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter PAN number"
                    {...register("panNo")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Billing Address</label>
                  <textarea
                    className={textAreaClass}
                    placeholder="Enter billing address"
                    {...register("billingAddress")}
                  />
                </div>

                <div>
                  <label className={labelClass}>Shipping Address</label>
                  <textarea
                    className={textAreaClass}
                    placeholder="Enter shipping address"
                    {...register("shippingAddress")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Credit Period</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter credit period"
                    {...register("creditPeriod")}
                  />
                </div>

                <div>
                  <label className={labelClass}>Credit Limit</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter credit limit"
                    {...register("creditLimit")}
                  />
                </div>

                <div>
                  <label className={labelClass}>PIN</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Enter PIN"
                    {...register("pin")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Country</label>
                  <select className={inputClass} {...register("country")}>
                    <option value="" disabled>
                      Select country
                    </option>
                    {countries.map((country) => (
                      <option
                        key={country.countryName}
                        value={country.countryName}
                      >
                        {country.countryName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>State</label>
                  {isIndia ? (
                    <select className={inputClass} {...register("state")}>
                      <option value="">Select state</option>
                      {INDIA_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Enter state"
                      {...register("state")}
                    />
                  )}
                </div>
              </div>
              </fieldset>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() =>
                    navigate(ROUTES.mastersPartyList, { replace: true })
                  }
                  className="rounded-sm border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isReadOnly}
                  className="rounded-sm bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting
                    ? isEdit
                      ? "Updating..."
                      : "Saving..."
                    : isEdit
                      ? "Update Party"
                      : "Create Party"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
