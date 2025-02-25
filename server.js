if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const passport = require('passport');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const initializePassport = require('./passport-config');

const app = express(); 

// PostgreSQL connection configuration 
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false // necessary for self-signed certificates 
  },
  connectionTimeoutMillis: 30000, // Increase timeout to 30 seconds
});


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Check if SESSION_SECRET is defined
if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not defined!');
} else {
  console.log('SESSION_SECRET is defined!');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Secure cookies in production
    maxAge: 60000 // Set cookie expiration (example: 1 minute)
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// Serve static HTML files
app.use(express.static(path.join(__dirname, 'views')));

// Initialize Passport
initializePassport(
  passport,
  async (email) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM users WHERE email = $1', [email]);
      return rows[0];
    } finally {
      client.release();
    }
  },
  async (id) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0];
    } finally {
      client.release();
    }
  }
);

// Signup route
app.post('/sign-up',  async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  const client = await connectWithRetry();
  try {
    // Check if users table exists, create if it doesn't
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        email VARCHAR(255),
        password VARCHAR(255),
        date DATE DEFAULT CURRENT_DATE
      );
    `);

    // Check if email is already registered
    const { rows } = await client.query('SELECT email FROM users WHERE email = $1', [email]);
    if (rows.length > 0) {
      return res.status(400).json({ message: 'Email is already registered' });
    }

    // Insert new user into the users table
    await client.query('INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4)', [firstName, lastName, email, hashedPassword]);

    res.status(201).json({ message: 'User registered successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    client.release();
    console.log('Database connection released');
  } 
});


async function connectWithRetry(retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log('Database connection acquired');
      return client;
    } catch (error) {
      console.error(`Database connection failed (attempt ${i + 1}): ${error.message}`);
      if (error.code === 'ENOTFOUND') {
        console.log('Endpoint not found. Please check your database host.');
      }
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      } 
    }
  }
}


app.post('/loggin',  async (req, res, next) => {
  console.log('Received login request');

  try {
    const client = await connectWithRetry();
    try {
      // Check if users table exists, create if it doesn't
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          email VARCHAR(255),
          password VARCHAR(255),
          date DATE DEFAULT CURRENT_DATE
        );
      `);
      console.log('Checked and ensured users table exists');

      // Authenticate user
      passport.authenticate('local', (err, user, info) => {
        if (err) {
          console.error('Error during authentication:', err);
          return res.status(500).json({ message: 'Internal Server Error during authentication' });
        }
        if (!user) {
          console.log('Authentication failed:', info.message);
          return res.status(400).json({ message: info.message });
        }
        req.logIn(user, (err) => {
          if (err) {
            console.error('Error during login:', err);
            return res.status(500).json({ message: 'Internal Server Error during login' });
          }
          console.log('User logged in successfully');
          return res.status(200).json({ message: 'Login successful' });
        });
      })(req, res, next);
    } finally {
      client.release();
      console.log('Database connection released');
    }
  } catch (error) {
    console.error('Error during database operation:', error);
    res.status(500).json({ message: 'Internal Server Error during database operation' });
  }
});




// Logout route
app.delete('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
    req.session.destroy();
    res.redirect('/login');
  });
});

// Products Page 
app.get('/products',  (req, res) => {
  console.log('Serving products page');
  res.sendFile(path.join(__dirname, 'views', 'products.html'));
});

// Get route to populate products table data on products page
app.get('/productstable',  async (req, res) => {
  const productType = req.query.type || 'Core';
  const sql = `SELECT product_id, product_name FROM productlist WHERE type = $1`;
  try {
    const client = await pool.connect();
    const result = await client.query(sql, [productType]);
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Adding a new product
app.post('/products/add',  async (req, res) => {
  try {
    // Retrieve the product details from the request body
    const { productName, productType } = req.body;

    // Generate the product ID by capitalizing the first letter of each word in the product name and removing spaces
    const productId = productName.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1)).replace(/\s/g, '');

    // Check if the product already exists in the database
    const client = await pool.connect();
    try {
      const { rows: existingProduct } = await client.query('SELECT product_id FROM productlist WHERE product_id = $1', [productId]);

      if (existingProduct.length > 0) {
        return res.status(400).json({ message: 'Product already exists' });
      }

      // Insert the new product into the database
      await client.query('INSERT INTO productlist (product_id, product_name, type) VALUES ($1, $2, $3)', [productId, productName, productType]);

      res.status(201).json({ message: 'Product added successfully' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Home page route
app.get('/',  (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'productds.html'));
});

// Login page route
app.get('/login',  (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Analysis Page //Get all tests
app.get('/teststable',  async (req, res) => {
  const sql = 'SELECT * FROM tableoftestsv1';

  try {
    const client = await pool.connect();
    try {
      const { rows: results } = await client.query(sql);
      if (results.length === 0) {
        res.status(404).send('No tests found');
        return;
      }
      res.json(results);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching tests:', error);
    res.status(500).send('Error fetching tests');
  }
});

// Define route to fetch test data by test ID
app.get('/teststable/:pId',  async (req, res) => {
  const productName = req.params.pId;
  console.log(productName);

  const sql = 'SELECT * FROM tableoftestsv1 WHERE Product = $1';

  try {
    const client = await pool.connect();
    try {
      const { rows: results } = await client.query(sql, [productName]);

      if (results.length === 0) {
        console.log('No tests found for productId:', productName);
        res.json([]); // Return an empty array if no tests are found
        return;
      }

      console.log('Tests found for productId:', productName);
      res.json(results);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching test data:', error);
    res.status(500).send('Internal Server Error');
  }
});


// Define route to fetch test data by test ID
app.get('/testsbyId',  async (req, res) => {
  const testId = req.query.testId;
  const sql = 'SELECT * FROM tableoftestsv1 WHERE Test_Id = $1';

  try {
    const client = await pool.connect();
    try {
      const { rows: results } = await client.query(sql, [testId]);

      if (results.length === 0) {
        res.status(404).send('Test not found');
        return;
      }

      res.json(results[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching test data:', error);
    res.status(500).send('Error fetching test data');
  }
});


app.get('/tests',  (req, res) => {
  res.sendFile(__dirname + '/views/tests.html');
});
// GET route to fetch test data based on product ID
app.get('/teststable/:pId',  async (req, res) => {
  const productName = req.params.pId;
  console.log(productName);

  // Query to fetch test data from the database based on the product ID
  const sql = 'SELECT * FROM tableoftestsv1 WHERE Product = $1';

  try {
    const client = await pool.connect();
    try {
      const { rows: result } = await client.query(sql, [productName]);

      // Check if any tests were found for the product
      if (result.length === 0) {
        console.log('No tests found for productId:', productName);
        res.json([]); // Return an empty array if no tests are found
        return;
      }

      // Return the fetched test data
      console.log('Tests found for productId:', productName);
      res.json(result);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


//add test
// POST route to add test data
app.post('/add-test-data',  async (req, res) => {
  const testData = req.body;

  const sql = `INSERT INTO tableoftestsv1 
               (Product, Device_Id, Board_Version, Firmware, Profile, Test_Engineer, Power_Source, Pump_Type, Pump_Id) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

  const values = [
    testData.productType,
    testData.DeviceIMEI,
    testData.boardVersion,
    testData.firmware,
    testData.profile,
    testData.testEngineer,
    testData.powerSource,
    testData.pumpType,
    testData.pumpserial,
  ];

  try {
    const client = await pool.connect();
    try {
      await client.query(sql, values);
      res.status(200).send('<script>window.location.reload();</script>Test added successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error adding test data:', error);
    res.status(500).send('Internal Server Error');
  }
});

// PATCH route to update test data
app.patch('/update-test-data',  async (req, res) => {
  const testId = parseInt(req.query.testId);
  const updatedData = req.body;

  const sql = `UPDATE tableoftestsv1 SET 
                Device_Id = $1,
                Board_Version = $2,
                Firmware = $3,
                Profile = $4,
                Test_Engineer = $5,
                Power_Source = $6,
                Pump_Type = $7,
                Pump_Id = $8
                WHERE Test_Id = $9`;

  const values = [
    updatedData.DeviceIMEI,
    updatedData.boardVersion,
    updatedData.firmware,
    updatedData.profile,
    updatedData.testEngineer,
    updatedData.powerSource,
    updatedData.pumpType,
    updatedData.pumpSerial,
    testId,
  ];

  try {
    const client = await pool.connect();
    try {
      await client.query(sql, values);
      res.status(200).send('<script>window.location.reload();</script>Test data updated successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating test data:', error);
    res.status(500).send('Internal Server Error');
  }
});




// Results Page
app.get('/results',  (req, res) => {
  res.sendFile(__dirname + '/views/results.html');
});

//fetch results data based on test ID
// GET route to fetch results data based on test ID (comparison page)
app.get('/resultstable',  async (req, res) => {
  const testId = req.query.testId; // Access testId from query parameters
  const sql = 'SELECT head, voltage, current, t1, t2, time, power, flowrate, efficiency FROM results WHERE test_id = $1';

  try {
    const client = await pool.connect();
    try {
      const { rows: results } = await client.query(sql, [testId]);

      if (results.length === 0) {
        console.log('No results found for testId:', testId);
        res.json([]); // Return an empty array if no tests are found
        return;
      }

      console.log('Results found for testId:', testId);
      res.json(results);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching test data:', error);
    res.status(500).send('Internal Server Error');
  }
});

// GET route to fetch results data based on test ID and product ID (Tests page)
app.get('/resultstable/:testId/:prodId',  async (req, res) => {
  const { testId, prodId } = req.params;
  const sql = 'SELECT head, voltage, current, t1, t2, time, power, flowrate, efficiency FROM results WHERE test_id = $1';

  try {
    const client = await pool.connect();
    try {
      const { rows: results } = await client.query(sql, [testId]);

      if (results.length === 0) {
        console.log('No results found for testId:', testId);
        res.json([]); // Return an empty array if no tests are found
        return;
      }

      console.log('Results found for testId:', testId);
      res.json(results);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching test data:', error);
    res.status(500).send('Internal Server Error');
  }
});

// POST route to save results
app.post('/saveResults',  async (req, res) => {
  const jsonData = req.body;
  const allValues = [];

  for (let i = 0; i < jsonData.length; i++) {
    const columnData = jsonData[i];
    const columnName = Object.keys(columnData)[0];
    const columnValues = columnData[columnName];

    // Assuming columnValues is an array with 10 values corresponding to the columns in the query
    allValues.push(columnValues);
  }

  // Generate a query with multiple rows
  const placeholders = allValues.map((_, i) => `($${i * 10 + 1}, $${i * 10 + 2}, $${i * 10 + 3}, $${i * 10 + 4}, $${i * 10 + 5}, $${i * 10 + 6}, $${i * 10 + 7}, $${i * 10 + 8}, $${i * 10 + 9}, $${i * 10 + 10})`).join(', ');
  const query = `INSERT INTO results (test_id, head, voltage, current, t1, t2, time, power, flowrate, efficiency) VALUES ${placeholders}`;

  // Flatten the allValues array
  const flattenedValues = allValues.flat();

  try {
    const client = await pool.connect();
    try {
      await client.query(query, flattenedValues);
      console.log('Data saved successfully');
      res.status(200).send('Data saved successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).send('Error saving data');
  }
});





//Reports
// GET route to serve reports page
app.get('/reports',  (req, res) => {
  res.sendFile(__dirname + '/views/reports.html');
});

// GET route to fetch all reports
app.get('/getreports',  async (req, res) => {
  const productType = req.query.type || 'core';
  const sql = `SELECT * FROM test_reports`;

  try {
    const client = await pool.connect();
    try {
      const { rows: results } = await client.query(sql);
      res.json(results);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// POST route to add a new report
app.post('/reports',  async (req, res) => {
  const { title, description } = req.body;
  const date = new Date();
  const query = 'INSERT INTO test_reports (title, description, date) VALUES ($1, $2, $3)';

  try {
    const client = await pool.connect();
    try {
      await client.query(query, [title, description, date]);
      res.status(201).json({ title, description, date });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error saving report:', error);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// DELETE route to delete a report
app.delete('/reports/:id',  async (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM test_reports WHERE id = $1';

  try {
    const client = await pool.connect();
    try {
      await client.query(query, [id]);
      console.log('Report deleted with ID:', id);
      res.json({ id });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// PUT route to update a report
app.put('/reports/:id',  async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;
  const query = 'UPDATE test_reports SET title = $1, description = $2 WHERE id = $3';

  try {
    const client = await pool.connect();
    try {
      await client.query(query, [title, description, id]);
      console.log('Report updated with ID:', id);
      res.json({ id, title, description });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

//comparison page
app.get('/comparison', 

  (req, res) => {
    res.sendFile(__dirname + '/views/comparison.html');
  });

// Authentication check middleware
function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    console.log('User is authenticated');
    return next();
  }
  console.log('User is not authenticated');
  res.redirect('/login');
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  next();
}


// Start local server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});