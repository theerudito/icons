chmod +x build/linux/build-deb.sh

./build/linux/build-deb.sh

sudo apt install ./build/installer/icons_1.0.0_amd64.deb

sudo apt remove icons
