const app = require('./app');

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`PALMZ running on http://localhost:${port}  (admin: /admin)`));
}
