import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";

import api from "../../api/client/apiClient";
import { fetchCompanyById, updateCompany } from "../../api/client/companyApi";
import companyIcon from "../../assets/icons/company.png";
import { countries, INDIA_STATES } from "../../constants/countries";
import { INDUSTRIES } from "../../constants/industries";
import uploadImageToCloudinary from "../../utils/uploadCloudinary";
import { companyQueryKeys } from "@/hooks/queries/companyQueries";
import { ROUTES } from "@/routes/paths";
import { FINANCIAL_YEAR_FORMATS } from "@/constants/year";

const financialYearSchema = z.object({
  format: z.enum([
    "april-march",
    "january-december",
    "february-january",
    "march-february",
    "may-april",
    "june-may",
    "july-june",
    "august-july",
    "september-august",
  ]),
  startingYear: z.coerce.number().min(1900).max(2999),
  startMonth: z.number().min(1).max(12),
  endMonth: z.number().min(1).max(12),
});

const schema = z.object({
  name: z.string().min(1, "Company name is required"),
  flat: z.string().optional(),
  road: z.string().optional(),
  place: z.string().min(1, "Place is required"),
  landmark: z.string().optional(),
  pin: z.string().min(3, "PIN is required"),
  country: z.string().min(1, "Country is required"),
  state: z.string().min(1, "State is required"),
  email: z.string().email("Invalid email"),
  mobile: z
    .string()
    .min(7, "Mobile is required")
    .regex(/^\d+$/, "Mobile must be digits"),
  gstNum: z.string().optional(),
  pan: z.string().optional(),
  website: z.string().optional(),
  currency: z.string().min(1, "Currency is required"),
  currencyName: z.string().min(1, "Currency name is required"),
  currencySymbol: z.string().min(1, "Currency symbol is required"),
  logo: z.string().url("Logo must be a valid URL").optional().or(z.literal("")),
  type: z.enum(["integrated", "standalone"]).default("integrated"),
  industry: z.string().min(1, "Industry is required"),
  financialYear: financialYearSchema,
});

const inputClass =
  "h-10 w-full rounded-sm border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";
const errorClass = "mt-1 text-xs text-rose-500";

function FieldLabel({ children, required = false }) {
  return (
    <label className={labelClass}>
      {children}
      {required ? <span className="ml-1 text-rose-500">*</span> : null}
    </label>
  );
}

function getFinancialYearOptions(start = 2010, end = 2040) {
  const years = [];
  for (let year = start; year <= end; year += 1) {
    years.push(year);
  }
  return years;
}

function normalizeFinancialYear(financialYear) {
  if (
    financialYear &&
    typeof financialYear === "object" &&
    !Array.isArray(financialYear)
  ) {
    return {
      format: financialYear.format || "april-march",
      startingYear: financialYear.startingYear || "",
      startMonth: financialYear.startMonth || 4,
      endMonth: financialYear.endMonth || 3,
    };
  }

  const parsedYear = Number.parseInt(financialYear, 10);
  return {
    format: "april-march",
    startingYear: Number.isNaN(parsedYear) ? "" : parsedYear,
    startMonth: 4,
    endMonth: 3,
  };
}

export default function CompanyRegisterPage() {
  const [searchParams] = useSearchParams();
  const companyId = searchParams.get("companyId");
  const isEdit = Boolean(companyId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState("");
  const financialYearOptions = useMemo(
    () => getFinancialYearOptions(2010, 2040),
    [],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    control,
  } = useForm({
    resolver: zodResolver(schema),
    mode: "onSubmit", // validate and show errors only on submit
    reValidateMode: "onChange",
    defaultValues: {
      type: "integrated",
      country: "India",
      state: "Kerala",
      currency: "",
      currencyName: "",
      currencySymbol: "",
      financialYear: {
        format: "april-march",
        startingYear: "",
        startMonth: 4,
        endMonth: 3,
      },
      industry: "",
      logo: "",
      name: "",
      flat: "",
      road: "",
      place: "",
      landmark: "",
      pin: "",
      email: "",
      mobile: "",
      gstNum: "",
      pan: "",
      website: "",
    },
  });

  const selectedCountry = useWatch({
    control,
    name: "country",
  });
  const watchedLogo = useWatch({
    control,
    name: "logo",
  });
  const selectedFinancialYearFormat = useWatch({
    control,
    name: "financialYear.format",
  });
  const selectedCountryMeta = useMemo(
    () =>
      countries.find((item) => item.countryName === selectedCountry) || null,
    [selectedCountry],
  );

  const isIndia = selectedCountry === "India";
  const effectiveLogoPreview = logoPreview || watchedLogo || "";

  useEffect(() => {
    const selectedFormat =
      FINANCIAL_YEAR_FORMATS.find(
        (item) => item.value === selectedFinancialYearFormat,
      ) || FINANCIAL_YEAR_FORMATS[0];

    setValue("financialYear.startMonth", selectedFormat.startMonth, {
      shouldValidate: true,
    });
    setValue("financialYear.endMonth", selectedFormat.endMonth, {
      shouldValidate: true,
    });
  }, [selectedFinancialYearFormat, setValue]);

  useEffect(() => {
    if (!selectedCountryMeta) {
      setValue("currency", "", { shouldValidate: false });
      setValue("currencyName", "", { shouldValidate: false });
      setValue("currencySymbol", "", { shouldValidate: false });
      return;
    }

    setValue("currency", selectedCountryMeta.currency, {
      shouldValidate: false,
    });
    setValue("currencyName", selectedCountryMeta.currencyName, {
      shouldValidate: false,
    });
    setValue("currencySymbol", selectedCountryMeta.symbol, {
      shouldValidate: false,
    });
  }, [selectedCountryMeta, setValue]);

  useEffect(() => {
    if (!companyId) return;

    const loadCompany = async () => {
      try {
        setLoadingCompany(true);
        const res = await fetchCompanyById(companyId);
        const company = res.data;
        const normalizedFinancialYear = normalizeFinancialYear(
          company.financialYear,
        );

        reset({
          name: company.name || "",
          flat: company.flat || "",
          road: company.road || "",
          place: company.place || "",
          landmark: company.landmark || "",
          pin: company.pin || "",
          country: company.country || "",
          state: company.state || "",
          email: company.email || "",
          mobile: company.mobile || "",
          gstNum: company.gstNum || "",
          pan: company.pan || "",
          website: company.website || "",
          logo: company.logo || "",
          type: company.type || "integrated",
          currency: company.currency || "",
          currencyName: company.currencyName || "",
          currencySymbol: company.currencySymbol || "",
          industry: company.industry || "",
          financialYear: normalizedFinancialYear,
        });
        setLogoPreview(company.logo || "");
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err.message ||
          "Failed to load company";
        toast.error(msg);
      } finally {
        setLoadingCompany(false);
      }
    };

    loadCompany();
  }, [companyId, reset]);

  const handleLogoFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Please select a valid image (JPEG, PNG, WebP)");
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error("Image size should be less than 5MB");
      return;
    }

    setLogoFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview("");
    setValue("logo", "", { shouldValidate: true });
  };

  const onSubmit = async (values) => {
    try {
      let logoUrl = values.logo?.trim() || "";

      if (logoFile) {
        logoUrl = await uploadImageToCloudinary(logoFile);
      }

      const selectedFormat =
        FINANCIAL_YEAR_FORMATS.find(
          (item) => item.value === values.financialYear.format,
        ) || FINANCIAL_YEAR_FORMATS[0];

      const payload = {
        name: values.name.trim(),
        flat: values.flat?.trim(),
        road: values.road?.trim(),
        place: values.place.trim(),
        landmark: values.landmark?.trim(),
        pin: values.pin.trim(),
        country: values.country.trim(),
        state: values.state.trim(),
        email: values.email.trim(),
        mobile: values.mobile.trim(),
        gstNum: values.gstNum?.trim(),
        pan: values.pan?.trim(),
        website: values.website?.trim(),
        logo: logoUrl,
        type: values.type,
        industry: values.industry.trim(),
        currency: values.currency.trim(),
        currencyName: values.currencyName.trim(),
        currencySymbol: values.currencySymbol.trim(),
        financialYear: {
          format: values.financialYear.format,
          startingYear: Number(values.financialYear.startingYear),
          startMonth: selectedFormat.startMonth,
          endMonth: selectedFormat.endMonth,
        },
      };

      if (isEdit) {
        const res = await updateCompany(companyId, payload);
        toast.success(res.data.message || "Company updated");
      } else {
        const res = await api.post("/company/register", payload);
        toast.success(res.data.message || "Company registered");
      }

      setValue("logo", logoUrl, { shouldValidate: true });
      setLogoFile(null);
      setLogoPreview(logoUrl);

      await queryClient.invalidateQueries({ queryKey: companyQueryKeys.all });
      if (companyId) {
        queryClient.removeQueries({
          queryKey: companyQueryKeys.detail(companyId),
          exact: true,
        });
      }
      navigate(ROUTES.mastersCompany, { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || "Save failed";
      toast.error(msg);
    }
  };

  return (
    <div className="w-full font-[sans-serif]">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-sm bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <img src={companyIcon} alt="Company" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 md:text-lg">
                {isEdit ? "Edit Company" : "Create Company"}
              </h2>
              <p className="text-xs text-slate-500 md:text-sm">
                {isEdit
                  ? "Update your company details"
                  : "Fill the details to register your company"}
              </p>
            </div>
          </div>

          {loadingCompany ? (
            <p className="text-sm text-slate-500">Loading company...</p>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <FieldLabel required>Company Name</FieldLabel>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("name")}
                  />
                  {errors.name && (
                    <p className={errorClass}>{errors.name.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel required>
                    Financial Year Starting (Year)
                  </FieldLabel>
                  <select
                    className={inputClass}
                    {...register("financialYear.startingYear")}
                  >
                    <option value="">Select year</option>
                    {financialYearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  {errors.financialYear?.startingYear && (
                    <p className={errorClass}>
                      {errors.financialYear.startingYear.message}
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel required>Industry</FieldLabel>
                  <select className={inputClass} {...register("industry")}>
                    <option value="">Select industry</option>
                    {INDUSTRIES.map((industry) => (
                      <option key={industry} value={industry}>
                        {industry}
                      </option>
                    ))}
                  </select>
                  {errors.industry && (
                    <p className={errorClass}>{errors.industry.message}</p>
                  )}
                </div>
              </div>

              <div>
                <FieldLabel required>Financial Year Format</FieldLabel>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {FINANCIAL_YEAR_FORMATS.map((format) => {
                    const isSelected =
                      selectedFinancialYearFormat === format.value;

                    return (
                      <button
                        key={format.value}
                        type="button"
                        onClick={() =>
                          setValue("financialYear.format", format.value, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }
                        className={`flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-slate-900 bg-slate-50 text-slate-900"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            setValue("financialYear.format", format.value, {
                              shouldValidate: true,
                              shouldDirty: true,
                            })
                          }
                          className="h-4 w-4 accent-slate-900"
                          readOnly
                        />
                        <span>{format.label}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.financialYear?.format && (
                  <p className={errorClass}>
                    {errors.financialYear.format.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Flat / Building</label>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("flat")}
                  />
                </div>

                <div>
                  <label className={labelClass}>Road</label>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("road")}
                  />
                </div>

                <div>
                  <FieldLabel required>Place / City</FieldLabel>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("place")}
                  />
                  {errors.place && (
                    <p className={errorClass}>{errors.place.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Landmark</label>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("landmark")}
                  />
                </div>

                <div>
                  <FieldLabel required>PIN / ZIP</FieldLabel>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("pin")}
                  />
                  {errors.pin && (
                    <p className={errorClass}>{errors.pin.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel required>Country</FieldLabel>
                  <select className={inputClass} {...register("country")}>
                    <option value="">Select country</option>
                    {countries.map((country) => (
                      <option
                        key={country.countryName}
                        value={country.countryName}
                      >
                        {country.countryName}
                      </option>
                    ))}
                  </select>
                  {errors.country && (
                    <p className={errorClass}>{errors.country.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel required>State</FieldLabel>
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
                  {errors.state && (
                    <p className={errorClass}>{errors.state.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <FieldLabel required>Email</FieldLabel>
                  <input
                    type="email"
                    className={inputClass}
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className={errorClass}>{errors.email.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel required>Mobile</FieldLabel>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("mobile")}
                  />
                  {errors.mobile && (
                    <p className={errorClass}>{errors.mobile.message}</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Website</label>
                  <input
                    type="text"
                    placeholder="www.example.com"
                    className={inputClass}
                    {...register("website")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>
                    {isIndia ? "GST Number" : "VAT Number"}
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder={
                      isIndia ? "Enter GST number" : "Enter VAT number"
                    }
                    {...register("gstNum")}
                  />
                </div>

                <div>
                  <label className={labelClass}>PAN</label>
                  <input
                    type="text"
                    className={inputClass}
                    {...register("pan")}
                  />
                </div>

                <div>
                  <label className={labelClass}>Company Logo</label>

                  {/* Show round placeholder when no logo */}
                  {!effectiveLogoPreview && (
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-400">
                      Logo
                    </div>
                  )}

                  {/* Show logo image when present */}
                  {effectiveLogoPreview && (
                    <div className="relative mb-2 inline-block">
                      <img
                        src={effectiveLogoPreview}
                        alt="Logo preview"
                        className="h-12 w-12 rounded-full border border-slate-200 object-contain"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white"
                      >
                        x
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileChange}
                      className="text-xs"
                    />
                    {logoFile && (
                      <span className="text-xs text-slate-500">
                        Logo will upload when you submit the form
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <FieldLabel required>Currency</FieldLabel>
                  <input
                    type="text"
                    className={`${inputClass} bg-slate-50`}
                    readOnly
                    {...register("currency")}
                  />
                  {errors.currency && (
                    <p className={errorClass}>{errors.currency.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel required>Currency Name</FieldLabel>
                  <input
                    type="text"
                    className={`${inputClass} bg-slate-50`}
                    readOnly
                    {...register("currencyName")}
                  />
                  {errors.currencyName && (
                    <p className={errorClass}>{errors.currencyName.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel required>Currency Symbol</FieldLabel>
                  <input
                    type="text"
                    className={`${inputClass} bg-slate-50`}
                    readOnly
                    {...register("currencySymbol")}
                  />
                  {errors.currencySymbol && (
                    <p className={errorClass}>
                      {errors.currencySymbol.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end border-t border-slate-100 pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-10 w-full rounded-sm bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? isEdit
                      ? "Updating..."
                      : "Saving..."
                    : isEdit
                      ? "Update Company"
                      : "Create Company"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
