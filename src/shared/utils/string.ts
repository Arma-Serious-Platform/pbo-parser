const generateRandomString = (count = 20, prefix = '') =>
  `${prefix}${Math.random().toString(count)}`.replaceAll('.', '');

const removeExtraSlashes = (string = '') => {
  return string.replaceAll('/\\/', '/').replaceAll('\\', '/');
};

const getImagePathsFromHTML = (htmlString: string) => {
  // Define a regular expression pattern to match the value of the image attribute
  const pattern = /src="([^"]+)"/;

  // Use the match function to extract the image path
  const matches = htmlString.match(pattern);

  // If matches are found, return the image path

  if (matches && matches.length > 1) {
    return matches[1];
  } else {
    // If no matches are found, return null or an empty string
    return null; // or return "";
  }
};

const extractImagePaths = (htmlText: string): string[] => {
  const regex = /<img[^>]+src=['"]([^'"]+)['"]/g;
  const paths = [];
  let match;
  while ((match = regex.exec(htmlText)) !== null) {
    paths.push(match[1]);
  }

  return paths;
};

export {
  generateRandomString,
  removeExtraSlashes,
  getImagePathsFromHTML,
  extractImagePaths,
};
