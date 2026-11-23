/** Lightweight authenticated probe. Authentication and company access run in route middleware. */
export const getReachability = (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(204).end();
};
